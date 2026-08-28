// 「上次没退干净的自己」怎么认出来。
//
// Windows 上应用退出后偶尔会留下 --type=renderer 的孤儿：无窗口、父 PID 已死，
// 却仍占着 %APPDATA% 与 release（下次打包报 EPERM）。它们与主进程同名同 exe，
// 所以只要确认「没有别的正常实例在跑」（拿到单实例锁那一刻），
// 同名进程就一律是僵尸。
//
// 判据刻意不用「父进程是否存活」：Windows 的 PID 会被回收复用，父 PID 指向的
// 可能早就是别的进程了；而且那需要枚举全部进程拿 ParentProcessId，慢得多。

/**
 * tasklist 的 CSV 行 → PID。
 *
 * 输出形如 `"kuma.exe","47216","Console","1","225,680 K"`，第二列是 PID。
 * 调用方按 latin1 读原样字节：映像名与 PID 列都是 ASCII，不解码就不受系统代码页影响。
 *
 * 没有匹配进程时 tasklist 会打一句本地化的「信息: 没有运行的任务…」，
 * 那行分不出第二列，自然被过滤掉——解析从不依赖那句话怎么写。
 */
export const parseTasklistPids = (csv: string, selfPid: number): number[] => {
  const pids: number[] = []
  for (const line of `${csv ?? ''}`.split(/\r?\n/)) {
    const cells = line.split('","')
    if (cells.length < 2) continue
    const pid = Number(cells[1])
    if (!Number.isInteger(pid) || pid <= 0 || pid === selfPid) continue
    pids.push(pid)
  }
  return pids
}
