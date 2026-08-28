// api_token 是 DMM 登录会话凭据，游戏把它塞进每条 kcsapi 请求的表单里。
// 账本 events 默认永久保留，凭据跟着 post_body 明文落盘等于把登录态写进磁盘；
// 而全部下游消费者（工厂统计、任务/装备恢复、补给归因、史的变动原因）只读业务参数。
// 纯函数不接触数据库，便于行为测试直接导入。
export const API_TOKEN_PLACEHOLDER = '<redacted>'

// post_body 的正常形态是广播器产出的 JSON 串（querystring.parse 后 stringify）；
// 表单串分支是兜底——格式意外不该成为凭据放行的理由。
export const redactPostBody = (postBody: string | null): string | null => {
  if (!postBody || !postBody.includes('api_token')) return postBody
  try {
    const post = JSON.parse(postBody)
    if (post && typeof post === 'object' && post.api_token !== undefined) {
      post.api_token = API_TOKEN_PLACEHOLDER
      return JSON.stringify(post)
    }
    return postBody
  } catch (_e) {
    return postBody.replace(/(^|&)api_token=[^&]*/g, `$1api_token=${API_TOKEN_PLACEHOLDER}`)
  }
}
