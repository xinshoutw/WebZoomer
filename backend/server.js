const express = require('express');
const http = require('http');
const {Server} = require("socket.io");
const cors = require('cors');

// --- 伺服器基本設定 ---
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// --- CORS 設定 ---
const allowedOrigin = "https://project.xinshou.tw";

// 設定 Express 的 CORS
app.use(cors({
    origin: allowedOrigin
}));

// 設定 Socket.IO 的 CORS
const io = new Server(server, {
    cors: {
        origin: allowedOrigin,
        methods: ["GET", "POST"]
    }
});

/**
 * @description 追蹤所有房間的狀態。
 * 結構: { roomId: { offerSent: boolean, members: Set<string> } }
 */
const roomState = {};

// 健康檢查路由
app.get('/', (req, res) => res.send('<h1>✅ WebRTC Signaling Server is Active</h1>'));

// --- Socket.IO 連線邏輯 ---
io.on('connection', (socket) => {
    console.log(`[Connect] User connected: ${socket.id}`);

    /**
     * 處理用戶加入房間的請求
     */
    socket.on('join-room', (roomId) => {
        // 初始化房間 (如果不存在)
        if (!roomState[roomId]) {
            roomState[roomId] = {
                offerSent: false,
                members: new Set()
            };
        }

        // 將用戶加入房間
        socket.join(roomId);
        roomState[roomId].members.add(socket.id);
        console.log(`[Join] User ${socket.id} joined room: ${roomId}`);

        const otherUsers = Array.from(roomState[roomId].members).filter(id => id !== socket.id);

        // 通知房間內的其他用戶，有新人加入了
        // 前端攝影機端會用此事件來發起呼叫
        otherUsers.forEach(userId => {
            io.to(userId).emit('user-joined', {userId: socket.id});
        });
    });

    /**
     * 處理 WebRTC 信令轉發的核心邏輯
     * 這是前端 peer 物件發出所有信號的統一入口
     */
    socket.on('forward-signal', (data) => {
        // 找到該用戶所在的房間
        const roomId = Array.from(socket.rooms).find(r => r !== socket.id);
        if (!roomId || !roomState[roomId]) return;

        const otherUser = Array.from(roomState[roomId].members).find(id => id !== socket.id);
        if (!otherUser) return;

        // 根據房間狀態決定事件名稱
        if (!roomState[roomId].offerSent) {
            // 這是第一個信令 (Offer)，使用專屬事件名稱
            console.log(`[Signal] Forwarding OFFER from ${socket.id} to ${otherUser}`);
            io.to(otherUser).emit('offer-received', {
                from: socket.id,
                signal: data.signal
            });
            roomState[roomId].offerSent = true; // 標記 Offer 已發送
        } else {
            // 這是後續的信令 (Answer)，使用通用事件名稱
            console.log(`[Signal] Forwarding ANSWER/ICE from ${socket.id} to ${otherUser}`);
            io.to(otherUser).emit('signal', {
                from: socket.id,
                signal: data.signal
            });
        }
    });

    /**
     * 處理用戶斷開連線
     * 使用 'disconnecting' 事件可以確保在 socket.rooms 資訊還存在時進行操作
     */
    socket.on('disconnecting', () => {
        console.log(`[Disconnecting] User starting to disconnect: ${socket.id}`);
        const rooms = Array.from(socket.rooms).filter(r => r !== socket.id);

        rooms.forEach(roomId => {
            if (roomState[roomId]) {
                // 通知房間內尚存的用戶
                const otherUser = Array.from(roomState[roomId].members).find(id => id !== socket.id);
                if (otherUser) {
                    console.log(`[Leave] Notifying ${otherUser} that ${socket.id} has left room ${roomId}`);
                    io.to(otherUser).emit('user-left');
                }
                // 清理房間狀態
                delete roomState[roomId];
            }
        });
    });

    socket.on('disconnect', () => {
        console.log(`[Disconnect] User disconnected: ${socket.id}`);
    });
});

// --- 啟動伺服器 ---
server.listen(PORT, () => {
    console.log(`🚀 Server listening on http://localhost:${PORT}`);
});