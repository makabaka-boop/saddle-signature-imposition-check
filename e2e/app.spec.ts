import { expect, test } from '@playwright/test';

async function setN(page: import('@playwright/test').Page, value: string) {
  const input = page.getByTestId('pages-input');
  await input.fill(value);
}

test.describe('骑马订核版台', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('首屏为空态：没有纸张与错误', async ({ page }) => {
    await expect(page.getByTestId('empty-hint')).toBeVisible();
    await expect(page.getByTestId('sheet-list')).toHaveCount(0);
    await expect(page.getByTestId('error-panel')).toHaveCount(0);
  });

  test('合法输入：按外层→内层显示全部纸张和纸张数', async ({ page }) => {
    await setN(page, '12');

    await expect(page.getByTestId('summary-pages')).toHaveText('12');
    await expect(page.getByTestId('summary-sheets')).toHaveText('3');

    const cards = page.getByTestId('sheet-card');
    await expect(cards).toHaveCount(3);

    // 外层→内层逐张核对公式
    const first = cards.nth(0);
    await expect(first.getByTestId('sheet-position')).toHaveText('1');
    await expect(first.getByTestId('current-side')).toHaveText('正面');
    await expect(first.getByTestId('page-left')).toContainText('12');
    await expect(first.getByTestId('page-right')).toContainText('1');

    const second = cards.nth(1);
    await expect(second.getByTestId('page-left')).toContainText('10');
    await expect(second.getByTestId('page-right')).toContainText('3');

    const third = cards.nth(2);
    await expect(third.getByTestId('page-left')).toContainText('8');
    await expect(third.getByTestId('page-right')).toContainText('5');

    // N=4 与 N=64 的纸张数边界
    await setN(page, '4');
    await expect(page.getByTestId('summary-sheets')).toHaveText('1');
    await expect(cards).toHaveCount(1);

    await setN(page, '64');
    await expect(page.getByTestId('summary-sheets')).toHaveText('16');
    await expect(cards).toHaveCount(16);
  });

  test('翻面只改变当前展示面，不改折手顺序也不重新生成', async ({ page }) => {
    await setN(page, '8');
    const cards = page.getByTestId('sheet-card');

    // 第一张：正面 8 / 1
    const first = cards.nth(0);
    await expect(first.getByTestId('page-left')).toContainText('8');
    await expect(first.getByTestId('page-right')).toContainText('1');

    // 翻到背面：左 2 / 右 7（沿竖直中线翻转后的阅读方向）
    await first.getByTestId('show-back').click();
    await expect(first.getByTestId('current-side')).toHaveText('背面');
    await expect(first.getByTestId('page-left')).toContainText('2');
    await expect(first.getByTestId('page-right')).toContainText('7');

    // 只影响当前张：第二张仍为正面
    const second = cards.nth(1);
    await expect(second.getByTestId('current-side')).toHaveText('正面');
    await expect(second.getByTestId('page-left')).toContainText('6');
    await expect(second.getByTestId('page-right')).toContainText('3');

    // 卡片顺序、纸张数不变
    await expect(page.getByTestId('summary-sheets')).toHaveText('2');
    const positions = await page
      .getByTestId('sheet-position')
      .allInnerTexts();
    expect(positions).toEqual(['1', '2']);

    // 翻回正面恢复原页码
    await first.getByTestId('show-front').click();
    await expect(first.getByTestId('current-side')).toHaveText('正面');
    await expect(first.getByTestId('page-left')).toContainText('8');
    await expect(first.getByTestId('page-right')).toContainText('1');
  });

  test('非法输入立即清除旧拼版并给出明确原因', async ({ page }) => {
    await setN(page, '16');
    await expect(page.getByTestId('sheet-card')).toHaveCount(4);

    // 小数
    await setN(page, '16.5');
    await expect(page.getByTestId('error-panel')).toBeVisible();
    await expect(page.getByTestId('error-message')).toContainText('整数');
    await expect(page.getByTestId('sheet-list')).toHaveCount(0);

    // 越界
    await setN(page, '68');
    await expect(page.getByTestId('error-message')).toContainText('4 至 64');

    await setN(page, '2');
    await expect(page.getByTestId('error-message')).toContainText('4 至 64');

    // 不能被 4 整除
    await setN(page, '10');
    await expect(page.getByTestId('error-message')).toContainText('被 4 整除');

    // 非数字
    await setN(page, 'abc');
    await expect(page.getByTestId('error-message')).toContainText('整数');

    // 重新输入合法值后恢复
    await setN(page, '20');
    await expect(page.getByTestId('error-panel')).toHaveCount(0);
    await expect(page.getByTestId('summary-sheets')).toHaveText('5');
    await expect(page.getByTestId('sheet-card')).toHaveCount(5);
  });

  test('清空输入立即回到空态并清除旧拼版', async ({ page }) => {
    await setN(page, '24');
    await expect(page.getByTestId('sheet-card')).toHaveCount(6);

    await setN(page, '');
    await expect(page.getByTestId('empty-hint')).toBeVisible();
    await expect(page.getByTestId('sheet-list')).toHaveCount(0);
    await expect(page.getByTestId('error-panel')).toHaveCount(0);
  });
});
