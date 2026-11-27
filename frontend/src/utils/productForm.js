export const slugify = (value) => String(value || '')
  .normalize('NFKD')
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 220)

export const newImageId = () => (
  globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
)

export const parseVariantOptions = (value) => {
  const options = {}
  String(value || '')
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const separator = part.indexOf('=')
      if (separator > 0) {
        const key = part.slice(0, separator).trim()
        const optionValue = part.slice(separator + 1).trim()
        if (key && optionValue) options[key] = optionValue
      }
    })
  return options
}

export const formatVariantOptions = (options) => Object
  .entries(options || {})
  .map(([key, value]) => `${key}=${value}`)
  .join(', ')

export const buildVariantCombinations = (definitions, base = {}) => {
  const optionSets = definitions
    .map((definition) => ({
      key: String(definition.key || '').trim(),
      values: String(definition.values || '')
        .split(/[,\n]/)
        .map((value) => value.trim())
        .filter(Boolean),
    }))
    .filter((definition) => definition.key && definition.values.length)

  if (!optionSets.length) return []

  let combinations = [{}]
  optionSets.forEach(({ key, values }) => {
    combinations = combinations.flatMap((combination) => (
      values.map((value) => ({ ...combination, [key]: value }))
    ))
  })

  return combinations.slice(0, 50).map((combination) => ({
    ...base,
    name: Object.values(combination).join(' / '),
    options: Object.entries(combination).map(([key, value]) => `${key}=${value}`).join(', '),
  }))
}

export const attributeValues = (value) => String(value || '')
  .split(/[,\n]/)
  .map((item) => item.trim())
  .filter(Boolean)
