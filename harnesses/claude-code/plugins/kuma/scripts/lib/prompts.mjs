import fs from "node:fs"
import path from "node:path"

export function loadPromptTemplate(promptsDir, name) {
  const filePath = path.join(promptsDir, `${name}.md`)
  return fs.readFileSync(filePath, "utf8")
}

export function interpolateTemplate(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  })
}
