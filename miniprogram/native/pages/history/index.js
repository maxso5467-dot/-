const { request } = require('../../utils/api')
Page({ data: { items: [], loading: false }, async onShow() { if (!wx.getStorageSync('health_token')) return; this.setData({ loading: true }); try { const data = await request('/consultations'); this.setData({ items: data.items || data || [] }) } catch (_) {} finally { this.setData({ loading: false }) } } })
