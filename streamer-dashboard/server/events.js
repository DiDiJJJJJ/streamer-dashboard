import { EventEmitter } from 'node:events'

// 进程内事件总线：当看板数据发生变更（抓取 / 导入 / 清空）时发出 'data-changed'，
// 用于驱动 SSE 实时推送，使手机端 / 电脑端在不依赖手动刷新的情况下即时同步最新数据。
export const bus = new EventEmitter()
bus.setMaxListeners(100)
