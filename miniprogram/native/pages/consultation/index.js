const { request } = require('../../utils/api')
Page({
  data: { title: '', message: '', answer: '', loading: false },
  onTitle(e) { this.setData({ title: e.detail.value }) }, onMessage(e) { this.setData({ message: e.detail.value }) },
  async submit() {
    if (!this.data.message.trim()) return wx.showToast({ title: '请先描述症状', icon: 'none' })
    this.setData({ loading: true })
    try {
      const data = await request('/consultations', { method: 'POST', data: { title: this.data.title || '健康咨询', message: this.data.message } })
      this.setData({ answer: data.reply || data.answer || '已记录症状，建议继续补充持续时间和伴随症状。' })
    } catch (error) { wx.showToast({ title: error.message, icon: 'none' }) }
    finally { this.setData({ loading: false }) }
  },
  showImageComingSoon() {
    wx.showToast({ title: '图片问诊功能正在开发中', icon: 'none', duration: 2200 })
  }
})
