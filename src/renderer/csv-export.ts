// 「导出成文件」的共用收口。原先鉴的列表、鉴的仓库、锐的编成互通各写一份，
// 三份逐行同构（转义、BOM、时间戳文件名、showSaveDialog、writeFileSync），
// 而 BOM 与失败反馈是分三次分别补上的——落下一份就是一个坑。
//
// 这里**只负责「存到哪、写没写成」**。徽章、flash 这类反馈留在各模块自己手里：
// 三处的展示位置（.lk2 / .es-export / deckIo.flash）与文案都是各自拍过板的，
// 不在这里统一。
//
// 纯文本那半边（转义/BOM/文件名戳）在 shared/csv-text，那边能被守卫真跑起来测。
export { csvCell, csvText, stampedFileName } from '../shared/csv-text'

/** 存盘结果。canceled 与 failed 必须分开——用户自己取消不该报「失败」。 */
export type SaveOutcome =
  | { status: 'saved'; filePath: string }
  | { status: 'canceled' }
  | { status: 'failed'; error: unknown }

/**
 * 保存对话框 + 写盘。
 *
 * 写盘真会失败（目标目录被占、只读介质、盘满、杀软拦截）。**失败必须回成
 * failed，不许抛出去也不许静默**：抛出去的话调用方的徽章一直挂着原文案，
 * 看起来像什么都没发生（三处都各自栽过这一下）。
 * 这里只记一笔 console.warn 留痕，怎么告诉用户由调用方决定。
 */
export const saveTextFile = async (
  options: {
    title: string
    defaultPath: string
    filters: { name: string; extensions: string[] }[]
    /** console.warn 的前缀，出事时一眼看出是哪个导出 */
    logLabel: string
  },
  text: string,
): Promise<SaveOutcome> => {
  // 选好的路径留在 try 外面：写盘炸了的话，日志里带上「往哪写」才查得动
  let chosenPath: string | null = null
  try {
    const remote = require('@electron/remote')
    const { canceled, filePath } = await remote.dialog.showSaveDialog({
      title: options.title,
      defaultPath: options.defaultPath,
      filters: options.filters,
    })
    if (canceled || !filePath) return { status: 'canceled' }
    chosenPath = filePath
    require('fs').writeFileSync(filePath, text, 'utf8')
    return { status: 'saved', filePath }
  } catch (error) {
    console.warn(`[kanso] ${options.logLabel}失败`, chosenPath ?? '(未选定路径)', error)
    return { status: 'failed', error }
  }
}
