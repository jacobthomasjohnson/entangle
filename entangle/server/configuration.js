import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

export async function loadConfiguration(directory) {
  const warnings = [];
  if (!directory) return { automations: [], scripts: {}, warnings: ['YAML configuration is not mounted. Automation and script references are unavailable.'] };
  let root;
  try { root = await fs.realpath(directory); } catch { return { automations: [], scripts: {}, warnings: ['YAML configuration directory is inaccessible.'] }; }
  let files = 0;
  async function read(file, ancestors = []) {
    const resolved = await fs.realpath(file);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Include outside configuration directory');
    if (ancestors.includes(resolved) || ancestors.length > 16 || ++files > 250) throw new Error('Include cycle or configuration limit exceeded');
    if ((await fs.stat(resolved)).size > 4 * 1024 * 1024) throw new Error('Configuration file exceeds 4 MB');
    const tags = ['include', 'include_dir_list', 'include_dir_merge_list', 'include_dir_named', 'include_dir_merge_named'].map(tag => ({ tag: `!${tag}`, resolve: value => ({ __include: tag, value }) }));
    tags.push({ tag: '!secret', resolve: () => null });
    const doc = YAML.parseDocument(await fs.readFile(resolved, 'utf8'), { customTags: tags, merge: true });
    if (doc.errors.length) throw new Error('Invalid YAML');
    if (doc.warnings.length) warnings.push('Unsupported YAML tags found; some references may be omitted.');
    const parsed = doc.toJS({ maxAliasCount: 100 });
    async function expand(value) {
      if (!value || typeof value !== 'object') return value;
      if (value.__include) {
        const target = path.resolve(path.dirname(resolved), String(value.value));
        if (value.__include === 'include') return read(target, [...ancestors, resolved]);
        const real = await fs.realpath(target);
        const rel = path.relative(root, real);
        if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Include outside configuration directory');
        const names = (await fs.readdir(real)).filter(n => /\.ya?ml$/i.test(n) && !n.startsWith('.')).sort();
        const values = [];
        for (const name of names) values.push(await read(path.join(real, name), [...ancestors, resolved]));
        if (value.__include === 'include_dir_list') return values;
        if (value.__include === 'include_dir_merge_list') return values.flat();
        if (value.__include === 'include_dir_named') return Object.fromEntries(names.map((n, i) => [n.replace(/\.ya?ml$/i, ''), values[i]]));
        return Object.assign({}, ...values);
      }
      if (Array.isArray(value)) { const result = []; for (const item of value) result.push(await expand(item)); return result; }
      const result = {}; for (const [key, item] of Object.entries(value)) result[key] = await expand(item); return result;
    }
    return expand(parsed);
  }
  try {
    const config = await read(path.join(root, 'configuration.yaml'));
    const automations = [], scripts = {};
    const collect = section => {
      for (const [key, value] of Object.entries(section || {})) {
        if (/^automation(?: |$)/.test(key)) { if (Array.isArray(value)) automations.push(...value); else warnings.push('An automation section could not be analyzed.'); }
        if (/^script(?: |$)/.test(key) && value && typeof value === 'object') Object.assign(scripts, value);
      }
    };
    collect(config);
    for (const section of Object.values(config?.homeassistant?.packages || {})) collect(section);
    return { automations, scripts, warnings: [...warnings, 'Coverage includes explicit entity, device and area references in accessible YAML only. Templates, dynamic targets, blueprints and UI-only configuration are not analyzed.'] };
  } catch { return { automations: [], scripts: {}, warnings: ['YAML configuration could not be fully read or parsed. Automation and script relationships are omitted. Check includes, permissions and YAML syntax.'] }; }
}
