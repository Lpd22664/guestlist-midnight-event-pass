import {expect, test, type Page} from '@playwright/test';

const demoKey = 'guestlist.synthetic-preview.v1';
const journey = ['Create pass', 'Present this pass', 'Try check-in', 'Check in'];

async function freshDemo(page:Page) {
  await page.goto('/#issue');
  await page.evaluate(()=>localStorage.clear());
  await page.reload();
  await expect(page.getByRole('textbox',{name:'Guest label',exact:true})).toBeVisible();
}
async function primary(page:Page, name:string) {
  // Count the actual visible primary buttons, not merely the expected label.
  const buttons=page.locator('main button.primary:visible');
  await expect(buttons).toHaveCount(1);
  await expect(buttons).toHaveAccessibleName(name);
  return buttons;
}
async function state(page:Page) {
  return page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),demoKey);
}
async function contained(page:Page) {
  const layout=await page.evaluate(()=>({fits:document.documentElement.scrollWidth<=innerWidth,width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:Array.from(document.querySelectorAll('main *')).map(node=>({tag:node.tagName,className:node.className,x:node.getBoundingClientRect().x,right:node.getBoundingClientRect().right})).filter(node=>node.x<0||node.right>innerWidth).slice(0,12)}));
  expect(layout.fits,JSON.stringify(layout)).toBe(true);
  const button=page.locator('main button.primary:visible');
  await expect(button).toHaveCount(1);
  const bounds=await button.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(await page.evaluate(()=>innerWidth));
}

test('the synthetic journey measures four actions with no copy or file transfer',async({page})=>{
  await freshDemo(page);
  const before=await state(page);
  expect(before.passes).toHaveLength(18);
  await page.getByRole('textbox',{name:'Guest label',exact:true}).fill('Morgan Journey');
  // Record real user activation events after label entry, including accidental
  // disclosure/navigation steps; a hard-coded click counter cannot pass this test.
  await page.evaluate(()=>{
    const log:{actions:string[];clipboard:number}={actions:[],clipboard:0};
    (window as unknown as {journeyLog:typeof log}).journeyLog=log;
    document.addEventListener('click',event=>{
      const target=(event.target as Element).closest('button, summary');
      if(target)log.actions.push(target.textContent!.trim().replace(/\s+/g,' '));
    },true);
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
      writeText:async()=>{log.clipboard++},readText:async()=>{log.clipboard++;return ''},
    }});
  });
  let fileTransfers=0;
  page.on('filechooser',()=>fileTransfers++);
  page.on('download',()=>fileTransfers++);
  for(const action of journey)await (await primary(page,action)).click();
  await expect(page.getByRole('heading',{name:'Admitted',exact:true})).toBeVisible();
  await expect(page.locator('.gate-result')).toBeFocused();
  await expect(page.getByText('Morgan Journey',{exact:true})).toBeVisible();
  const measured=await page.evaluate(()=>(window as unknown as {journeyLog:{actions:string[];clipboard:number}}).journeyLog);
  expect(measured.actions).toEqual(journey);
  expect(measured.actions).toHaveLength(4);
  expect(measured.clipboard).toBe(0);
  expect(fileTransfers).toBe(0);
  expect(await page.locator('main input[type=file]').count()).toBe(0);
  const admitted=await state(page);
  expect(admitted.passes).toHaveLength(19);
  expect(admitted.activity).toHaveLength(before.activity.length+2);
  expect(admitted.passes.find((pass:{label:string})=>pass.label==='Morgan Journey').status).toBe('used');
  await expect(page.getByText('Local preview · synthetic data',{exact:true})).toBeVisible();
  // A single, direct replay must be rejected, without adding another admission.
  await (await primary(page,'Test this used pass again')).click();
  await expect(page.getByRole('heading',{name:'Already used',exact:true})).toBeVisible();
  await expect(page.getByText('No entry recorded',{exact:true})).toBeVisible();
  expect((await state(page)).activity).toHaveLength(admitted.activity.length);
});

test('top Check-in and browser history keep the newly selected pass',async({page})=>{
  await freshDemo(page);
  await page.getByRole('textbox',{name:'Guest label',exact:true}).fill('Taylor Selected');
  await (await primary(page,'Create pass')).click();
  await expect(await primary(page,'Present this pass')).toBeFocused();
  await (await primary(page,'Present this pass')).click();
  await expect(page.locator('main')).toBeFocused();
  await expect(page.locator('.demo-tools')).not.toHaveAttribute('open','');
  await page.getByRole('navigation',{name:'Pass workflow'}).getByRole('button',{name:'Check-in',exact:true}).click();
  await expect(page.locator('.gate-pass-summary')).toContainText('Taylor Selected');
  const credential=await page.getByRole('textbox',{name:'Credential to check in',exact:true}).inputValue();
  await page.goBack();
  await expect(page.getByText('Taylor Selected',{exact:true})).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('textbox',{name:'Credential to check in',exact:true})).toHaveValue(credential);
  await (await primary(page,'Check in')).press('Enter');
  await expect(page.getByRole('heading',{name:'Admitted',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Present pass',exact:true}).click();
  await expect(page.getByText('Taylor Selected',{exact:true})).toBeVisible();
  await expect(page.getByText('Already used',{exact:true})).toBeVisible();
});

for(const width of [320,390])for(const textScale of [100,200]){
  test(`four actions fit ${width}px with ${textScale}% text`,async({page})=>{
    await page.setViewportSize({width,height:844});
    await freshDemo(page);
    await page.evaluate(scale=>document.documentElement.style.fontSize=`${scale}%`,textScale);
    await page.getByRole('textbox',{name:'Guest label',exact:true}).fill('Alex '+'W'.repeat(40));
    for(const action of journey){
      await primary(page,action);
      await contained(page);
      // Keyboard activation also checks the controls remain reachable/actionable.
      await (await primary(page,action)).press('Enter');
    }
    await expect(page.getByRole('heading',{name:'Admitted',exact:true})).toBeVisible();
    await contained(page);
    await (await primary(page,'Test this used pass again')).press('Enter');
    await expect(page.getByRole('heading',{name:'Already used',exact:true})).toBeVisible();
    await contained(page);
  });
}


test('selected demo pass and its used state survive presentation and gate reloads',async({page})=>{
  await freshDemo(page);
  await page.getByRole('textbox',{name:'Guest label',exact:true}).fill('Robin Reload');
  await page.getByRole('button',{name:'Create pass',exact:true}).click();
  await page.getByRole('button',{name:'Present this pass',exact:true}).click();
  await page.reload();
  await expect(page.getByText('Robin Reload',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Try check-in',exact:true}).click();
  await page.reload();
  await expect(page.locator('.gate-pass-summary')).toContainText('Robin Reload');
  await page.getByRole('button',{name:'Check in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Admitted',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Present pass',exact:true}).click();
  await page.reload();
  await expect(page.getByText('Robin Reload',{exact:true})).toBeVisible();
  await expect(page.getByText('Already used',{exact:true})).toBeVisible();
});
