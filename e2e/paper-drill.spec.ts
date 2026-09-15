import { expect, test, type Page } from '@playwright/test';

async function setN(page: Page, value: string) {
  await page.getByTestId('pages-input').fill(value);
}

/** 四个机器方位槽里当前落位的角标字母。 */
async function cornerLayout(page: Page) {
  const slots = ['NW', 'NE', 'SE', 'SW'] as const;
  const layout: Record<string, string> = {};
  for (const slot of slots) {
    layout[slot] = (
      await page.getByTestId(`corner-slot-${slot}`).innerText()
    ).trim();
  }
  return layout;
}

test.describe('走纸方向演练区', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('起点：正面朝上、箭头朝北、角标 A–D 归位、轨迹为空', async ({ page }) => {
    await expect(page.getByTestId('paper-drill')).toBeVisible();
    await expect(page.getByTestId('drill-face')).toHaveText('正面朝上');
    await expect(page.getByTestId('drill-arrow')).toHaveText('北');
    await expect(page.getByTestId('drill-arrow-icon')).toHaveAttribute(
      'data-direction',
      'N',
    );
    expect(await cornerLayout(page)).toEqual({
      NW: 'A',
      NE: 'B',
      SE: 'C',
      SW: 'D',
    });
    await expect(page.getByTestId('drill-count')).toHaveText('0');
    await expect(page.getByTestId('drill-step')).toHaveCount(0);
    await expect(page.getByTestId('drill-invalid')).toHaveCount(0);
    await expect(page.getByTestId('drill-limit-hint')).toHaveCount(0);
  });

  test('两种动作实时绘出面、箭头、角标与轨迹', async ({ page }) => {
    // 顺时针旋转 90°：仍正面朝上，箭头朝东，角标顺时针移位
    await page.getByTestId('drill-rotate').click();
    await expect(page.getByTestId('drill-face')).toHaveText('正面朝上');
    await expect(page.getByTestId('drill-arrow')).toHaveText('东');
    expect(await cornerLayout(page)).toEqual({
      NW: 'D',
      NE: 'A',
      SE: 'B',
      SW: 'C',
    });

    // 沿进纸轴翻纸：背面朝上，东西互换
    await page.getByTestId('drill-flip').click();
    await expect(page.getByTestId('drill-face')).toHaveText('背面朝上');
    await expect(page.getByTestId('drill-arrow')).toHaveText('西');
    expect(await cornerLayout(page)).toEqual({
      NW: 'A',
      NE: 'D',
      SE: 'C',
      SW: 'B',
    });

    // 轨迹逐步记录动作与结果姿态
    await expect(page.getByTestId('drill-count')).toHaveText('2');
    const steps = page.getByTestId('drill-step');
    await expect(steps).toHaveCount(2);
    await expect(steps.nth(0)).toContainText('顺时针旋转 90°');
    await expect(steps.nth(0)).toContainText('正面朝上 · 箭头朝东');
    await expect(steps.nth(1)).toContainText('沿进纸轴翻纸');
    await expect(steps.nth(1)).toContainText('背面朝上 · 箭头朝西');
  });

  test('连续四次旋转或两次翻纸回到起点', async ({ page }) => {
    for (let i = 0; i < 4; i += 1) {
      await page.getByTestId('drill-rotate').click();
    }
    await expect(page.getByTestId('drill-face')).toHaveText('正面朝上');
    await expect(page.getByTestId('drill-arrow')).toHaveText('北');
    expect(await cornerLayout(page)).toEqual({
      NW: 'A',
      NE: 'B',
      SE: 'C',
      SW: 'D',
    });

    await page.getByTestId('drill-flip').click();
    await expect(page.getByTestId('drill-face')).toHaveText('背面朝上');
    await page.getByTestId('drill-flip').click();
    await expect(page.getByTestId('drill-face')).toHaveText('正面朝上');
    await expect(page.getByTestId('drill-arrow')).toHaveText('北');
    expect(await cornerLayout(page)).toEqual({
      NW: 'A',
      NE: 'B',
      SE: 'C',
      SW: 'D',
    });
  });

  test('旋转后翻纸与翻纸后旋转呈现不同角标布局', async ({ page }) => {
    // 先转后翻：箭头朝西，A 回西北
    await page.getByTestId('drill-rotate').click();
    await page.getByTestId('drill-flip').click();
    await expect(page.getByTestId('drill-face')).toHaveText('背面朝上');
    await expect(page.getByTestId('drill-arrow')).toHaveText('西');
    const rotateThenFlip = await cornerLayout(page);
    expect(rotateThenFlip).toEqual({ NW: 'A', NE: 'D', SE: 'C', SW: 'B' });

    // 重新演练（刷新），先翻后转：箭头朝东，A 落东南
    await page.reload();
    await page.getByTestId('drill-flip').click();
    await page.getByTestId('drill-rotate').click();
    await expect(page.getByTestId('drill-face')).toHaveText('背面朝上');
    await expect(page.getByTestId('drill-arrow')).toHaveText('东');
    const flipThenRotate = await cornerLayout(page);
    expect(flipThenRotate).toEqual({ NW: 'C', NE: 'B', SE: 'A', SW: 'D' });

    expect(flipThenRotate).not.toEqual(rotateThenFlip);
  });

  test('轨迹达到 24 步后不再接收动作并提示刷新', async ({ page }) => {
    for (let i = 0; i < 24; i += 1) {
      await page.getByTestId('drill-rotate').click();
    }
    await expect(page.getByTestId('drill-count')).toHaveText('24');
    await expect(page.getByTestId('drill-step')).toHaveCount(24);
    // 24 = 6 × 4 次旋转，画面回到起点
    await expect(page.getByTestId('drill-face')).toHaveText('正面朝上');
    await expect(page.getByTestId('drill-arrow')).toHaveText('北');

    // 动作按钮停用，提示刷新可重新演练
    await expect(page.getByTestId('drill-rotate')).toBeDisabled();
    await expect(page.getByTestId('drill-flip')).toBeDisabled();
    await expect(page.getByTestId('drill-limit-hint')).toBeVisible();
    await expect(page.getByTestId('drill-limit-hint')).toContainText('24');
    await expect(page.getByTestId('drill-limit-hint')).toContainText('刷新');
  });

  test('与既有核版交互的状态隔离', async ({ page }) => {
    // 先建立核版状态：N=8，第 1 张翻到背面
    await setN(page, '8');
    const cards = page.getByTestId('sheet-card');
    await expect(cards).toHaveCount(2);
    await cards.nth(0).getByTestId('show-back').click();
    await expect(cards.nth(0).getByTestId('current-side')).toHaveText('背面');

    // 操作演练：旋转 + 翻纸
    await page.getByTestId('drill-rotate').click();
    await page.getByTestId('drill-flip').click();
    await expect(page.getByTestId('drill-count')).toHaveText('2');

    // 核版状态不被重算、清除或改变：总页数、纸张数、各纸展示面、页码都不变
    await expect(page.getByTestId('summary-pages')).toHaveText('8');
    await expect(page.getByTestId('summary-sheets')).toHaveText('2');
    await expect(cards.nth(0).getByTestId('current-side')).toHaveText('背面');
    await expect(cards.nth(0).getByTestId('page-left')).toContainText('2');
    await expect(cards.nth(0).getByTestId('page-right')).toContainText('7');
    await expect(cards.nth(1).getByTestId('current-side')).toHaveText('正面');
    await expect(cards.nth(1).getByTestId('page-left')).toContainText('6');

    // 反向隔离：核版输入变化（含变非法）不影响演练轨迹与当前姿态
    await setN(page, '16');
    await expect(page.getByTestId('summary-pages')).toHaveText('16');
    await expect(page.getByTestId('drill-count')).toHaveText('2');
    await expect(page.getByTestId('drill-step')).toHaveCount(2);
    await expect(page.getByTestId('drill-face')).toHaveText('背面朝上');
    await expect(page.getByTestId('drill-arrow')).toHaveText('西');

    await setN(page, 'abc');
    await expect(page.getByTestId('error-panel')).toBeVisible();
    await expect(page.getByTestId('drill-count')).toHaveText('2');
    await expect(page.getByTestId('drill-face')).toHaveText('背面朝上');

    // 核版输入变化后各纸展示面按既有规则重置为正面，演练区不联动
    await setN(page, '8');
    await expect(cards.nth(0).getByTestId('current-side')).toHaveText('正面');
    await expect(page.getByTestId('drill-count')).toHaveText('2');
  });
});
