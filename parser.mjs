export class InputError extends Error {}
const tz = 'Asia/Shanghai';
export function localParts(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(now).map(x=>[x.type,x.value]));
  return {date:`${p.year}-${p.month}-${p.day}`, time:`${p.hour}:${p.minute}`};
}
function cn(v) {
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v);
  const digits = {'零':0,'〇':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
  if(v.includes('点')) { const [a,b]=v.split('点'); return cn(a)+Number('0.'+[...b].map(x=>digits[x]??x).join('')); }
  let total=0, current=0;
  for(const c of v) { if(c==='百'||c==='十') {total+=(current||1)*(c==='百'?100:10);current=0;} else if(c in digits) current=digits[c]; else return NaN; }
  return total+current;
}
const num='[0-9零〇一二两三四五六七八九十百]+(?:[.点][0-9零〇一二两三四五六七八九]+)?';
const int='[0-9零〇一二两三四五六七八九十]+';
const pad=x=>String(x).padStart(2,'0');
export function validateMeasurement(m) {
  m.mealContext=m.mealContext??null;
  if(m.mealContext!==null&&m.mealContext!=='after_meal')throw new InputError('测量标注不正确，请选择未标注或饭后。');
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+08:00$/.test(m.measuredAt)) throw new InputError('请选择完整的测量日期和时间。');
  const d=new Date(m.measuredAt);
  if(!Number.isFinite(+d)||localParts(d).date+'T'+localParts(d).time+':00+08:00'!==m.measuredAt) throw new InputError('日期或时间不存在，请检查。');
  if(+d > Date.now()+5*60*1000) throw new InputError('不能记录未来的测量，请检查日期和时间。');
  for(const [key,min,max,label] of [['weight',20,400,'体重（公斤）'],['waist',20,250,'腰围（厘米）']]) {
    if(m[key]!==null && (typeof m[key]!=='number'||!Number.isFinite(m[key])||m[key]<min||m[key]>max)) throw new InputError(`${label}超出可记录范围，请检查数值和单位。`);
  }
  if(m.weight===null&&m.waist===null) throw new InputError('请至少填写体重或腰围。');
  return m;
}
export function parseLine(input, now = new Date()) {
  const source=input.trim();
  let text=source.normalize('NFKC').replace(/公斤|千克/gi,'kg').replace(/厘米|公分/gi,'cm');
  text=text.replace(new RegExp(`((?:体重|腰围)\\s*(?:是|为|到了|到|[:：=])?\\s*)(${num})`,'g'),(_,prefix,value)=>prefix+cn(value));
  if(!text || text.length>500) throw new InputError('每条记录请控制在 500 字以内。');
  if(/[?？]|多少|怎么|是否|如果|目标|希望|计划|想要|不记|没测|没有|不是|改成|修改|更正|删除|预计|应该|大概|可能|左右|不要|吗|么/.test(text)) throw new InputError('这句话包含提问、目标或更正意图，未保存。请直接报告测量值；更正已有记录请使用表格中的编辑按钮。');
  const mealPattern=/(?:早|午|晚)?(?:饭|餐)后|吃完(?:早|午|晚)?饭(?:后)?/g;
  const mealContext=mealPattern.test(text)?'after_meal':null;
  if(mealContext&&/饭前|餐前|空腹|(?:没|未|不)\s*(?:吃|饭|餐)/.test(text))throw new InputError('饭后标注有歧义，请每行只报告一次测量，并明确是否饭后。');
  text=text.replace(mealPattern,'');
  const current=localParts(now);
  let date=current.date,time='08:00',timeSource='default';
  if(/现在|刚刚|刚测|此刻/.test(text)) {time=current.time;timeSource='now';text=text.replace(/现在|刚刚|刚测|此刻/g,'');}
  const relative=text.match(/前天|昨天|今天/);
  if(relative) {const offset=relative[0]==='前天'?-2:relative[0]==='昨天'?-1:0;date=new Date(Date.parse(current.date+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);text=text.replace(relative[0],'');}
  const absolute=text.match(/(?:(\d{4})[-/年])?(\d{1,2})[-/月](\d{1,2})(?:日|号)?/);
  if(absolute) {date=`${absolute[1]||current.date.slice(0,4)}-${pad(absolute[2])}-${pad(absolute[3])}`;text=text.replace(absolute[0],'');}
  const clock=text.match(new RegExp(`(凌晨|早上|上午|中午|下午|晚上|晚间)?\\s*(${int})(?:[:：]|点|时)(半|一刻|三刻|${int})?(?:分)?`));
  if(clock) {
    let hour=cn(clock[2]),minute=clock[3]==='半'?30:clock[3]==='一刻'?15:clock[3]==='三刻'?45:clock[3]?cn(clock[3]):0;
    const period=clock[1];
    if(['下午','晚上','晚间'].includes(period)&&hour<12)hour+=12;
    if(period==='中午'&&hour<11)hour+=12;
    if(period==='凌晨'&&hour===12)hour=0;
    if(hour>23||minute>59)throw new InputError('时间不正确，请使用例如“16:50”的写法。');
    time=`${pad(hour)}:${pad(minute)}`;timeSource='explicit';text=text.replace(clock[0],'');
  } else if(/早上|上午|中午|下午|晚上|晚间|凌晨/.test(text)) {
    throw new InputError('请给出具体时间，例如“晚上 8 点 76.0”。完全不写时间时默认上午 08:00。');
  }
  const explicitWeight=[...text.matchAll(new RegExp(`(?:体重|重量)\\s*(?:是|为|到了|到|[:：=])?\\s*(${num})\\s*(kg|KG|斤)?`,'g'))];
  const explicitWaist=[...text.matchAll(new RegExp(`腰围\\s*(?:是|为|到了|到|[:：=])?\\s*(${num})\\s*(cm|CM|厘米|公分)?`,'g'))];
  if(explicitWeight.length>1||explicitWaist.length>1)throw new InputError('多次测量请分行输入，每行记录一次。');
  let weight=null,waist=null;
  if(explicitWeight.length){const m=explicitWeight[0];weight=cn(m[1])*(m[2]==='斤'?0.5:1);text=text.replace(m[0],'');}
  if(explicitWaist.length){const m=explicitWaist[0];waist=cn(m[1]);text=text.replace(m[0],'');}
  if(weight===null){const unit=text.match(new RegExp(`(${num})\\s*(kg|KG|斤)`));if(unit){weight=cn(unit[1])*(unit[2]==='斤'?0.5:1);text=text.replace(unit[0],'');}}
  if(weight===null && waist===null){
    const plain=text.replace(/我|的|测量|测了|称了|称重|记录|一下|是|为|体重|[\s,:：，。!！]/g,'');
    if(new RegExp(`^${num}$`).test(plain)){weight=cn(plain);text='';}
  }
  if(new RegExp(num).test(text))throw new InputError('还有无法归属的数字，未保存。请用“体重 75.2，腰围 84”或将多次测量分行输入。');
  if(weight===null&&waist===null)throw new InputError('没有识别到测量值。试试“现在 75.2”或“腰围 84 厘米”。');
  const measuredAt=`${date}T${time}:00+08:00`;
  // Validate calendar and ranges here; server validates future dates with its own clock on save.
  const d=new Date(measuredAt);
  if(!Number.isFinite(+d)||localParts(d).date!==date||localParts(d).time!==time)throw new InputError('日期或时间不存在，请检查。');
  for(const [v,min,max,label] of [[weight,20,400,'体重'],[waist,20,250,'腰围']])if(v!==null&&(!Number.isFinite(v)||v<min||v>max))throw new InputError(`${label}超出可记录范围，请检查数值和单位。`);
  if(+d>+now+5*60000 && !(timeSource==='default'&&date===current.date&&time==='08:00'))throw new InputError('不能记录未来的测量，请检查日期和时间。');
  return {measuredAt,weight:weight===null?null:Math.round(weight*100)/100,waist:waist===null?null:Math.round(waist*100)/100,source,timeSource,mealContext};
}
export function parseInput(text,now=new Date()){
  if(typeof text!=='string'||text.length>3000)throw new InputError('输入过长，请分批记录。');
  const lines=text.split(/[\n;；]+/).map(x=>x.trim()).filter(Boolean);
  if(!lines.length||lines.length>10)throw new InputError('一次可记录 1–10 条测量，每条单独一行。');
  return lines.map(x=>parseLine(x,now));
}
