export default defineAppConfig({
  pages: [
    'pages/login/index',
    'pages/home/index',
    'pages/consultation/index',
    'pages/profile/index',
    'pages/history/index'
  ],
  subPackages: [],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#173a34',
    navigationBarTitleText: '玄武健康',
    navigationBarTextStyle: 'white',
    backgroundColor: '#f4f7f5'
  },
  tabBar: {
    color: '#6b7874',
    selectedColor: '#277a68',
    backgroundColor: '#ffffff',
    borderStyle: 'white',
    list: [
      { pagePath: 'pages/home/index', text: '首页' },
      { pagePath: 'pages/consultation/index', text: '问诊' },
      { pagePath: 'pages/profile/index', text: '档案' },
      { pagePath: 'pages/history/index', text: '历史' }
    ]
  }
})
