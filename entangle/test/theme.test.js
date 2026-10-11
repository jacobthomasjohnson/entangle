import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeTheme,themeStyle,colorFields} from '../src/theme.js';
test('appearance validates stored colors and clamps sizing preferences',()=>{
 const key=colorFields[0].key;
 assert.deepEqual(sanitizeTheme({[key]:'url(evil)','font-scale':9,'radius-scale':-1,unknown:'red'}),{'font-scale':1.3,'radius-scale':0});
 assert.deepEqual(themeStyle({[key]:'#aAbBcC'}),{['--'+key]:'#aAbBcC'});
 for (const value of [null,[],false,'invalid']) assert.deepEqual(sanitizeTheme(value),{});
 assert.deepEqual(sanitizeTheme({'spacing-scale':NaN}),{});
});
