import fs from 'fs'
import path from 'path'

const srcDir = path.resolve('src')
const files = []
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.(js|jsx|ts|tsx)$/.test(e.name) && !p.includes('__tests__')) files.push(p)
  }
}
walk(srcDir)

const imports = {}
for (const f of files) {
  const rel = path.relative(srcDir, f).replace(/\\/g, '/')
  const raw = fs.readFileSync(f, 'utf8')
  const re = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"];?/g
  let m
  imports[rel] = []
  while ((m = re.exec(raw)) !== null) {
    const target = m[1]
    if (target.startsWith('.')) {
      const base = path.resolve(path.dirname(f), target)
      const found = [base, base + '.js', base + '.jsx', base + '/index.js', base + '/index.jsx'].find((x) => fs.existsSync(x))
      if (found) {
        const tRel = path.relative(srcDir, found).replace(/\\/g, '/')
        imports[rel].push(tRel)
      }
    }
  }
}

const cycles = []
function dfs(n, stack, visited) {
  visited.add(n)
  stack.push(n)
  for (const c of imports[n] || []) {
    if (stack.includes(c)) {
      const idx = stack.indexOf(c)
      cycles.push(stack.slice(idx).concat(c))
    } else if (!visited.has(c)) {
      dfs(c, stack, visited)
    }
  }
  stack.pop()
}
const visited = new Set()
for (const n of Object.keys(imports)) {
  if (!visited.has(n)) dfs(n, [], visited)
}

console.log('files:', files.length, 'cycles:', cycles.length)
for (const c of cycles.slice(0, 20)) console.log('cycle:', c.join(' -> '))
