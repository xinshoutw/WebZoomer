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

/**
 * @description 追蹤所有房間的狀態。
 * 結構: { roomId: { members: Set<string>, offerSent: boolean } }
 */
const roomState = {};

// 健康檢查路由
app.get('/', (req, res) => res.send('<h1>✅ WebRTC Signaling Server is Active and Robust</h1>'));

// --- Socket.IO 連線邏輯 ---
io.on('connection', (socket) => {
    console.log(`[Connect] User connected: ${socket.id}`);

    /**
     * 處理用戶加入房間的請求
     */
    socket.on('join-room', (roomId) => {
        if (!/^\d{4}$/.test(roomId)) {
            socket.emit('error', { message: 'Invalid room ID format.' });
            return;
        }

        // 為使用者離開時的清理作準備
        socket.roomId = roomId;

        // 初始化房間 (如果不存在)
        if (!roomState[roomId]) {
            roomState[roomId] = {
                members: new Set(),
                offerSent: false,
            };
        }

        if (roomState[roomId].members.size >= 2) {
            console.log(`[Room Full] User ${socket.id} failed to join full room: ${roomId}`);
            socket.emit('room-full', { message: 'This room is full.' });
            return;
        }

        // 將用戶加入房間
        socket.join(roomId);
        roomState[roomId].members.add(socket.id);
        console.log(`[Join] User ${socket.id} joined room: ${roomId}. Members: ${roomState[roomId].members.size}`);

        // 通知房間內的其他用戶，有新人加入了
        const otherUser = Array.from(roomState[roomId].members).find(id => id !== socket.id);
        if (otherUser) {
            io.to(otherUser).emit('user-joined', { userId: socket.id });
        }
    });

    /**
     * 處理 WebRTC 信令轉發的核心邏輯
     */
    socket.on('forward-signal', (data) => {
        const roomId = socket.roomId;
        if (!roomId || !roomState[roomId]) return;

        const otherUser = Array.from(roomState[roomId].members).find(id => id !== socket.id);
        if (!otherUser) return;

        if (!roomState[roomId].offerSent) {
            console.log(`[Signal] Forwarding OFFER from ${socket.id} to ${otherUser}`);
            io.to(otherUser).emit('offer-received', { from: socket.id, signal: data.signal });
            roomState[roomId].offerSent = true;
        } else {
            console.log(`[Signal] Forwarding ANSWER/ICE from ${socket.id} to ${otherUser}`);
            io.to(otherUser).emit('signal', { from: socket.id, signal: data.signal });
        }
    });

    /**
     * 處理用戶斷開連線
     */
    socket.on('disconnecting', () => {
        console.log(`[Disconnecting] User starting to disconnect: ${socket.id}`);
        const roomId = socket.roomId;

        if (roomId && roomState[roomId]) {
            // 從成員列表中移除該用戶
            roomState[roomId].members.delete(socket.id);
            console.log(`[Leave] User ${socket.id} left room: ${roomId}. Members left: ${roomState[roomId].members.size}`);

            // 【修復問題一】重置通話狀態，讓攝影機可以對下一個人發起新通話
            roomState[roomId].offerSent = false;

            // 通知房間內尚存的用戶
            const remainingUser = Array.from(roomState[roomId].members)[0];
            if (remainingUser) {
                io.to(remainingUser).emit('user-left');
            }

            // 【健壯性增強】如果房間空了，從記憶體中刪除這個房間以釋放資源
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

// --- 啟動伺服器 ---
server.listen(PORT, () => {
    console.log(`🚀 Server listening on http://localhost:${PORT}`);
});