const { request } = require('../../utils/api')

Page({
  data: { username: 'zhangsan', password: '123456', loading: false },
  onUsername(event) { this.setData({ username: event.detail.value }) },
  onPassword(event) { this.setData({ password: event.detail.value }) },
  async login() {
    this.setData({ loading: true })
    try {
      const data = await request('/auth/login', { method: 'POST', data: { username: this.data.username, password: this.data.password } })
      wx.setStorageSync('health_token', data.accessToken)
      wx.setStorageSync('health_user', data.user)
      wx.switchTab({ url: '/pages/home/index' })
    } catch (error) { wx.showToast({ title: error.message, icon: 'none' }) }
    finally { this.setData({ loading: false }) }
  },
  wechatLogin() { wx.showToast({ title: '请先配置微信 AppID 和密钥', icon: 'none' }) }
})
