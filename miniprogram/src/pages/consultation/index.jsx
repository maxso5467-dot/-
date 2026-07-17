import { useState } from 'react'
import Taro from '@tarojs/taro'
import { Button, Picker, ScrollView, Text, Textarea, View } from '@tarojs/components'
import { api, ensureLogin } from '../../utils/api'
import './index.scss'

const options = {
  bodyPart: ['头部', '胸部', '腹部', '背部', '上肢', '下肢', '皮肤', '咽喉'],
  symptom: ['疼痛', '瘙痒', '肿胀', '红疹', '发热', '麻木', '头晕', '咳嗽'],
  duration: ['1小时内', '1天', '2天', '3-7天', '1-4周', '1个月以上'],
  severity: ['轻度，不影响活动', '中度，影响部分活动', '重度，无法正常活动'],
  accompanying: ['无明显伴随症状', '伴随发热', '伴随恶心或呕吐', '伴随肿胀或出血', '伴随呼吸困难']
}

export default function ConsultationPage() {
  const [mode, setMode] = useState('standard')
  const [language, setLanguage] = useState('zh-CN')
  const [guided, setGuided] = useState({ bodyPart: 5, symptom: 0, duration: 2, severity: 1, accompanying: 0 })
  const [text, setText] = useState('')
  const [sessionId, setSessionId] = useState(null)
  const [messages, setMessages] = useState([])
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(false)
  const [guidedApplied, setGuidedApplied] = useState(false)

  function composeGuidedText() {
    const subject = mode === 'child' ? '儿童患者' : mode === 'elder' ? '老年患者' : '本人'
    setText(`${subject}${options.bodyPart[guided.bodyPart]}出现${options.symptom[guided.symptom]}，持续${options.duration[guided.duration]}，程度为${options.severity[guided.severity]}，${options.accompanying[guided.accompanying]}。`)
    setGuidedApplied(true)
  }

  async function send() {
    if (!ensureLogin() || !text.trim()) return
    setLoading(true)
    try {
      let id = sessionId
      if (!id) {
        const session = await api('/consultations', { method: 'POST', data: { title: '小程序智能问诊', channel: 'text' } })
        id = session.id; setSessionId(id)
      }
      setMessages((items) => [...items, { sender: 'user', content: text }])
      const data = await api(`/consultations/${id}/messages/text`, {
        method: 'POST', data: { content: text, context: { source: 'miniprogram', careMode: mode, outputLanguage: language, guided: guidedApplied } }
      })
      setMessages((items) => [...items, { sender: 'assistant', content: data.reply }])
      setAnalysis(data.analysis); setText(''); setGuidedApplied(false)
    } catch (error) { Taro.showToast({ title: error.message, icon: 'none' }) }
    finally { setLoading(false) }
  }

  return <View className={`page care-${mode}`}>
    <View className='segments'>{[['standard', '普通'], ['child', '儿童'], ['elder', '老人']].map(([value, label]) => <View key={value} className={`segment ${mode === value ? 'active' : ''}`} onClick={() => setMode(value)}>{label}</View>)}</View>
    <View className='language-switch' onClick={() => setLanguage(language === 'zh-CN' ? 'zh-CN,en' : 'zh-CN')}>回复：{language === 'zh-CN' ? '中文' : '中英双语'}</View>
    <View className='panel'>
      <View className='panel-title'>症状自查</View>
      {Object.keys(options).map((key) => <Picker key={key} mode='selector' range={options[key]} value={guided[key]} onChange={(event) => setGuided({ ...guided, [key]: Number(event.detail.value) })}>
        <View className='picker'>{options[key][guided[key]]}</View>
      </Picker>)}
      <Button className='secondary-button' onClick={composeGuidedText}>生成症状描述</Button>
    </View>
    <View className='panel'>
      <Textarea className='textarea' value={text} placeholder='描述你的不适，或使用上方症状自查' onInput={(event) => { setText(event.detail.value); setGuidedApplied(false) }} />
      <Button className='primary-button' loading={loading} onClick={send}>发送问诊</Button>
    </View>
    <ScrollView scrollY className='chat-list'>
      {messages.map((message, index) => <View key={index} className={`message ${message.sender}`}><Text>{message.content}</Text></View>)}
    </ScrollView>
    {analysis && <View className='panel analysis'>
      <View className='analysis-head'><Text className='panel-title'>问诊结果</Text><Text className={`risk-${analysis.risk.level}`}>{analysis.risk.level}</Text></View>
      <Text className='analysis-label'>建议科室</Text><Text>{analysis.risk.department}</Text>
      <Text className='analysis-label'>需要补充</Text>
      {(analysis.followUpQuestions || []).map((item, index) => <Text className='question' key={index}>{index + 1}. {item.question}</Text>)}
      <Text className='analysis-label'>行动建议</Text><Text>{analysis.risk.action}</Text>
    </View>}
  </View>
}
