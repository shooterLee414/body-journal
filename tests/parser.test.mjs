import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLine,parseInput} from '../parser.mjs';
const now=new Date('2026-10-08T15:40:00Z');
test('bare weight defaults to 08:00 Shanghai',()=>{const r=parseLine('75.1',now);assert.equal(r.weight,75.1);assert.equal(r.measuredAt,'2026-10-08T08:00:00+08:00');});
test('now uses current Shanghai time',()=>{const r=parseLine('现在，75.8',now);assert.equal(r.measuredAt,'2026-10-08T23:40:00+08:00');});
test('weight and waist in one observation',()=>{const r=parseLine('今天体重 75.2 公斤，腰围 84 厘米',now);assert.equal(r.weight,75.2);assert.equal(r.waist,84);});
test('Chinese time and jin conversion',()=>{const r=parseLine('昨天下午四点50，体重150斤，腰围八十四厘米',now);assert.equal(r.weight,75);assert.equal(r.waist,84);assert.equal(r.measuredAt,'2026-10-07T16:50:00+08:00');});
test('Chinese decimal measurement does not become time',()=>{const r=parseLine('体重七十五点二，腰围八十三点五',now);assert.equal(r.weight,75.2);assert.equal(r.waist,83.5);});
test('explicit date and half hour',()=>{const r=parseLine('10月6日晚上八点半 76.0',now);assert.equal(r.measuredAt,'2026-10-06T20:30:00+08:00');});
test('waist-only does not invent weight',()=>{const r=parseLine('腰围 84',now);assert.equal(r.weight,null);assert.equal(r.waist,84);});
test('batch accepts individual measurements',()=>{assert.equal(parseInput('昨天 08:00 76.1\n现在 75.2',now).length,2);});
test('batch rejects atomically when a line is ambiguous',()=>{assert.throws(()=>parseInput('75.2\n明天希望75',now));});
test('invalid dates, times, goals, negatives and ambiguities are rejected',()=>{for(const text of ['2月30日 75','25:80 75','目标75','75 76','今晚75','体重-75','75.2，腰围多少','明天75','晚上 75','体重75体重76','现在体重可能75','现在75，75'])assert.throws(()=>parseLine(text,now),text);});
test('same value repeated is valid input',()=>{assert.equal(parseInput('75.1\n75.1',now).length,2);});
test('near midnight preserves date',()=>{const r=parseLine('现在 75',new Date('2026-10-08T16:01:00Z'));assert.equal(r.measuredAt,'2026-10-09T00:01:00+08:00');});
test('default 08:00 convention also works before 08:00',()=>{const r=parseLine('75.2',new Date('2026-10-07T23:00:00Z'));assert.equal(r.measuredAt,'2026-10-08T08:00:00+08:00');});

test('meal context is explicit, per measurement, and does not change time rules',()=>{
 for(const text of ['饭后75.2','餐后 75.2','午饭后75.2','吃完饭 75.2']){
  const r=parseLine(text,now);assert.equal(r.mealContext,'after_meal');assert.equal(r.weight,75.2);assert.equal(r.measuredAt,'2026-10-08T08:00:00+08:00');
 }
 const r=parseLine('现在饭后体重75.2，腰围84',now);assert.equal(r.mealContext,'after_meal');assert.equal(r.measuredAt,'2026-10-08T23:40:00+08:00');assert.equal(r.waist,84);
 assert.equal(parseLine('昨天晚上八点半，餐后腰围84',now).mealContext,'after_meal');
 assert.deepEqual(parseInput('饭后75.2\n75.2',now).map(r=>r.mealContext),['after_meal',null]);
 for(const text of ['不是饭后75.2','还没吃完饭75.2','空腹饭后75.2','饭前饭后75.2'])assert.throws(()=>parseLine(text,now),text);
});
