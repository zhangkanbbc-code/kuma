const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const parseKcwikiQuestRequirements = (records) => {
  if (!Array.isArray(records) || records.length > 5_000) {
    throw new Error('kcwiki quest data must be a bounded array')
  }
  const out = {}
  for (const [index, record] of records.entries()) {
    const questId = record?.game_id
    if (!Number.isInteger(questId) || questId <= 0) {
      throw new Error(`invalid game_id at row ${index}`)
    }
    if (!isRecord(record.requirements) || typeof record.requirements.category !== 'string') {
      throw new Error(`quest ${questId} has no structured requirements`)
    }
    if (Object.hasOwn(out, questId)) throw new Error(`duplicate quest id ${questId}`)
    out[questId] = structuredClone(record.requirements)
  }
  return out
}
