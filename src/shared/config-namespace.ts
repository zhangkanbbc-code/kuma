/** 配置对象的当前命名空间。 */
export const CONFIG_ROOT = 'kuma'

/** 读时兜底在正式版（版本号去掉 `-beta` 预发布后缀那一版）随使用说明那句一起撤除；整对象搬迁逻辑永久留，此旧名仍供其使用。 */
export const LEGACY_CONFIG_ROOT = 'kanso'

// KUMA_DATA_DIR 只覆盖数据目录的位置，不跳过该目录内 config.json 的对象迁移。
// data-dir 的「显式覆盖跳过搬迁」属于目录层，与这里的配置对象层无关。
// 旧有新无才复制；其余三种组合不搬。两个都在时用新的，不合并、不删旧的。
export const planConfigMigration = (
  { hasLegacy, hasCurrent }: { hasLegacy: boolean; hasCurrent: boolean },
): { migrate: boolean } => ({ migrate: hasLegacy && !hasCurrent })
