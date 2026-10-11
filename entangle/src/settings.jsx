import React from 'react';
import { colorFields, scales } from './theme.js';
export function AppearanceSettings({theme,onChange,onClose,notice}) {
 return <section className="appearance-settings" aria-labelledby="settings-title">
  <div className="settings-heading"><div><small>Settings / Appearance</small><h1 id="settings-title">Appearance</h1><p>Changes apply immediately and save in this browser for Live and Sandbox.</p></div><button autoFocus onClick={onClose}>Back to app</button></div>
  {notice && <p role="status">{notice}</p>}
  <div className="appearance-preview"><h2>Live preview</h2><p>Text, panel colors, spacing, and corners update as you edit.</p><button>Example control</button> <small>Secondary text</small></div>
  <h2>Size and spacing</h2><div className="theme-fields">{scales.map(f=><label key={f.key}>{f.label}<span><input type="range" min={f.min} max={f.max} step="0.05" value={theme[f.key] ?? 1} onChange={e=>onChange({...theme,[f.key]:Number(e.target.value)})}/><output>{Math.round((theme[f.key] ?? 1)*100)}%</output></span></label>)}</div>
  <h2>Colors</h2><div className="theme-fields">{colorFields.map(f=><label key={f.key}>{f.label}<span><input type="color" value={theme[f.key] || f.value} onChange={e=>onChange({...theme,[f.key]:e.target.value})}/><code>{theme[f.key] || f.value}</code><button aria-label={`Reset ${f.label}`} disabled={!theme[f.key]} onClick={()=>{const next={...theme};delete next[f.key];onChange(next);}}>Reset</button></span></label>)}</div>
  <button onClick={()=>onChange({})}>Restore default appearance</button>
 </section>;
}
