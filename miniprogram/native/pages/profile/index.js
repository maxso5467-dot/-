Page({ data: { user: {}, profile: {} }, onShow() { this.setData({ user: wx.getStorageSync('health_user') || {} }) }, logout() { wx.clearStorageSync(); wx.reLaunch({ url: '/pages/login/index' }) } })
