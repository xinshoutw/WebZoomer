const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

// --- 伺服器基本設定 ---
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// --- CORS 設定 ---
const allowedOrigin = "https://project.xinshou.tw";
app.use(cors({ origin: allowedOrigin }));
const io = new Server(server, {
    cors: {
        origin: allowedOrigin,
        methods: ["GET", "POST"]
    },
});

const roomState = {};

app.get('/', (req, res) => res.send('<h1>✅ WebRTC Signaling Server is Active and Robust</h1>'));

io.on('connection', (socket) => {
    console.log(`[Connect] User connected: ${socket.id}`);

    socket.on('join-room', (roomId) => {
        if (!/^\d{4}$/.test(roomId)) {
            socket.emit('error', { message: 'Invalid room ID format.' });
            return;
        }

        if (!roomState[roomId]) {
            roomState[roomId] = {
                members: new Set(),
                offerSent: false,
            };
        }

        if (roomState[roomId].members.size >= 2) {
            console.log(`[Room Full] User ${socket.id} failed to join full room: ${roomId}`);
            socket.emit('room-full', { message: 'This room is full.' });
            return; // 因為在這裡 return，所以不會執行到後面的加入邏輯
        }

        // 【主要修復點一】只有在所有檢查通過後，才將使用者與房間關聯
        socket.roomId = roomId; // 賦值操作移到這裡
        socket.join(roomId);
        roomState[roomId].members.add(socket.id);
        console.log(`[Join] User ${socket.id} joined room: ${roomId}. Members: ${roomState[roomId].members.size}`);

        const otherUser = Array.from(roomState[roomId].members).find(id => id !== socket.id);
        if (otherUser) {
            io.to(otherUser).emit('user-joined', { userId: socket.id });
        }
    });

    socket.on('forward-signal', (data) => {
        const roomId = socket.roomId;
        if (!roomId || !roomState[roomId]) return;
        const otherUser = Array.from(roomState[roomId].members).find(id => id !== socket.id);
        if (!otherUser) return;

        if (!roomState[roomId].offerSent) {
            io.to(otherUser).emit('offer-received', { from: socket.id, signal: data.signal });
            roomState[roomId].offerSent = true;
        } else {
            io.to(otherUser).emit('signal', { from: socket.id, signal: data.signal });
        }
    });

    socket.on('disconnecting', () => {
        console.log(`[Disconnecting] User starting to disconnect: ${socket.id}`);
        const roomId = socket.roomId;

        // 如果該使用者從未成功加入任何房間，則直接忽略
        if (!roomId || !roomState[roomId]) {
            return;
        }

        // 【主要修復點二】雙重確認該使用者是否真的是這個房間的成員
        if (roomState[roomId].members.has(socket.id)) {
            // 從成員列表中移除該用戶
            roomState[roomId].members.delete(socket.id);
            console.log(`[Leave] User ${socket.id} left room: ${roomId}. Members left: ${roomState[roomId].members.size}`);

            // 重置通話狀態，讓攝影機可以對下一個人發起新通話
            roomState[roomId].offerSent = false;

            // 通知房間內尚存的用戶
            const remainingUser = Array.from(roomState[roomId].members)[0];
            if (remainingUser) {
                io.to(remainingUser).emit('user-left');
            }

            if (roomState[roomId].members.size === 0) {
                console.log(`[Cleanup] Deleting empty room: ${roomId}`);
                delete roomState[roomId];
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`[Disconnect] User disconnected: ${socket.id}`);
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Server listening on http://localhost:${PORT}`);
});