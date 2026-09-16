import { expect, test, type Page } from '@playwright/test';

async function fillStaple(
  page: Page,
  values: { spineLength?: string; tolerance?: string; planned?: string; measured?: string },
): Promise<void> {
  if (values.spineLength !== undefined) {
    await page.getByTestId('staple-spine-input').fill(values.spineLength);
  }
  if (values.tolerance !== undefined) {
    await page.getByTestId('staple-tolerance-input').fill(values.tolerance);
  }
  if (values.planned !== undefined) {
    await page.getByTestId('staple-planned-input').fill(values.planned);
  }
  if (values.measured !== undefined) {
    await page.getByTestId('staple-measured-input').fill(values.measured);
  }
}

const MIXED = {
  spineLength: '300',
  tolerance: '3',
  // 计划 30/100/170/240；实测 31/169/200。
  // 全局 DP：30→31、170→169；漏 100 与 240；200 为多余钉痕。
  planned: '30, 100, 170, 240',
  measured: '31, 169, 200',
};

test.describe('钉位检测区', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('首屏为录入态：只有录入提示，没有诊断结论', async ({ page }) => {
    await expect(page.getByTestId('staple-inspection')).toBeVisible();
    await expect(page.getByTestId('staple-entry-hint')).toBeVisible();
    await expect(page.getByTestId('staple-result')).toHaveCount(0);
    await expect(page.getByTestId('staple-invalid-panel')).toHaveCount(0);
    await expect(page.getByTestId('staple-analyze')).toBeVisible();
    await expect(page.getByTestId('staple-clear')).toBeVisible();
  });

  test('混合漏钉与多余钉痕：展示配对连线、毫米偏差、漏钉、多余钉痕', async ({ page }) => {
    await fillStaple(page, MIXED);
    await page.getByTestId('staple-analyze').click();

    const result = page.getByTestId('staple-result');
    await expect(result).toBeVisible();
    // 录入提示与待修正面板都不应出现
    await expect(page.getByTestId('staple-entry-hint')).toHaveCount(0);
    await expect(page.getByTestId('staple-invalid-panel')).toHaveCount(0);

    // 判定不合格（2 漏钉 + 1 多余钉痕）
    const verdict = page.getByTestId('staple-verdict');
    await expect(verdict).toBeVisible();
    await expect(verdict).toHaveAttribute('data-pass', 'false');
    await expect(verdict).toContainText('钉位不合格');

    await expect(page.getByTestId('staple-summary-pairs')).toHaveText('2');
    await expect(page.getByTestId('staple-summary-missing')).toHaveText('2');
    await expect(page.getByTestId('staple-summary-extra')).toHaveText('1');

    // 配对连线：两条（30→31、170→169），且与清单配对一致
    await expect(page.getByTestId('staple-pair-line')).toHaveCount(2);
    const pairRows = page.getByTestId('staple-pair-row');
    await expect(pairRows).toHaveCount(2);
    await expect(pairRows.nth(0)).toContainText('第 1 个');
    await expect(pairRows.nth(0)).toContainText('第 1 痕');
    await expect(pairRows.nth(0).getByTestId('staple-pair-deviation')).toContainText('+1');
    await expect(pairRows.nth(0).getByTestId('staple-pair-status')).toHaveText('合格');
    await expect(pairRows.nth(1)).toContainText('第 3 个');
    await expect(pairRows.nth(1)).toContainText('第 2 痕');
    await expect(pairRows.nth(1).getByTestId('staple-pair-deviation')).toContainText('-1');
    await expect(pairRows.nth(1).getByTestId('staple-pair-status')).toHaveText('合格');

    // 漏钉：第 2 个计划位 100、第 4 个计划位 240
    const missingRows = page.getByTestId('staple-missing-row');
    await expect(missingRows).toHaveCount(2);
    await expect(missingRows.nth(0)).toContainText('第 2 个计划位');
    await expect(missingRows.nth(0)).toContainText('100');
    await expect(missingRows.nth(1)).toContainText('第 4 个计划位');
    await expect(missingRows.nth(1)).toContainText('240');

    // 多余钉痕：第 3 痕 200
    const extraRows = page.getByTestId('staple-extra-row');
    await expect(extraRows).toHaveCount(1);
    await expect(extraRows.nth(0)).toContainText('第 3 痕');
    await expect(extraRows.nth(0)).toContainText('200');
  });

  test('全部在容差内且无漏钉/多痕时判定合格', async ({ page }) => {
    await fillStaple(page, {
      spineLength: '300',
      tolerance: '2',
      planned: '30, 150, 270',
      measured: '31, 150, 269',
    });
    await page.getByTestId('staple-analyze').click();

    await expect(page.getByTestId('staple-verdict')).toHaveAttribute('data-pass', 'true');
    await expect(page.getByTestId('staple-verdict')).toContainText('钉位合格');
    await expect(page.getByTestId('staple-summary-pairs')).toHaveText('3');
    await expect(page.getByTestId('staple-summary-missing')).toHaveText('0');
    await expect(page.getByTestId('staple-summary-extra')).toHaveText('0');
    await expect(page.getByTestId('staple-missing-row')).toHaveCount(0);
    await expect(page.getByTestId('staple-extra-row')).toHaveCount(0);
    await expect(page.getByTestId('staple-missing-empty')).toBeVisible();
    await expect(page.getByTestId('staple-extra-empty')).toBeVisible();
    // 全部连线为合格样式
    const overLines = page.locator('.staple-diagram__line--over');
    await expect(overLines).toHaveCount(0);
  });

  test('超差配对在连线上标红、判定不合格', async ({ page }) => {
    await fillStaple(page, {
      spineLength: '300',
      tolerance: '3',
      planned: '100, 200',
      measured: '100, 209',
    });
    await page.getByTestId('staple-analyze').click();
    await expect(page.getByTestId('staple-verdict')).toHaveAttribute('data-pass', 'false');
    await expect(page.locator('.staple-diagram__line--over')).toHaveCount(1);
    const rows = page.getByTestId('staple-pair-row');
    await expect(rows.nth(1)).toContainText('超差');
  });

  test('分析后改动任一输入立即撤销旧诊断，回到录入态', async ({ page }) => {
    await fillStaple(page, MIXED);
    await page.getByTestId('staple-analyze').click();
    await expect(page.getByTestId('staple-result')).toBeVisible();
    await expect(page.getByTestId('staple-verdict')).toHaveAttribute('data-pass', 'false');

    // 改动书脊长度：旧诊断立即撤销，录入内容保留
    await page.getByTestId('staple-spine-input').fill('297');
    await expect(page.getByTestId('staple-result')).toHaveCount(0);
    await expect(page.getByTestId('staple-entry-hint')).toBeVisible();
    await expect(page.getByTestId('staple-spine-input')).toHaveValue('297');

    // 改列表输入同样立即撤销
    await page.getByTestId('staple-analyze').click();
    await expect(page.getByTestId('staple-result')).toBeVisible();
    await page.getByTestId('staple-measured-input').fill('31, 169');
    await expect(page.getByTestId('staple-result')).toHaveCount(0);
    await expect(page.getByTestId('staple-entry-hint')).toBeVisible();
  });

  test('清空检测：清空全部录入并回到录入态', async ({ page }) => {
    await fillStaple(page, MIXED);
    await page.getByTestId('staple-analyze').click();
    await expect(page.getByTestId('staple-result')).toBeVisible();

    await page.getByTestId('staple-clear').click();
    await expect(page.getByTestId('staple-result')).toHaveCount(0);
    await expect(page.getByTestId('staple-entry-hint')).toBeVisible();
    await expect(page.getByTestId('staple-spine-input')).toHaveValue('');
    await expect(page.getByTestId('staple-tolerance-input')).toHaveValue('');
    await expect(page.getByTestId('staple-planned-input')).toHaveValue('');
    await expect(page.getByTestId('staple-measured-input')).toHaveValue('');
    await expect(page.getByTestId('staple-invalid-panel')).toHaveCount(0);
  });

  test('待修正态：列表未严格递增 / 重复 / 超出书脊 / 参数不完整都定位到对应项', async ({ page }) => {
    // 未严格递增 + 重复：计划 30,100,100,90
    await fillStaple(page, {
      spineLength: '300',
      tolerance: '3',
      planned: '30, 100, 100, 90',
      measured: '30',
    });
    await page.getByTestId('staple-analyze').click();
    await expect(page.getByTestId('staple-result')).toHaveCount(0);
    const panel = page.getByTestId('staple-invalid-panel');
    await expect(panel).toBeVisible();
    const invalidItems = page.getByTestId('staple-invalid-item');
    await expect(invalidItems).toHaveCount(2);
    await expect(invalidItems.nth(0)).toContainText('第 3 项');
    await expect(invalidItems.nth(0)).toContainText('重复');
    await expect(invalidItems.nth(1)).toContainText('第 4 项');
    await expect(invalidItems.nth(1)).toContainText('严格递增');
    // 对应输入与第 3、4 项 token 被标记
    await expect(page.getByTestId('staple-planned-input')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(page.locator('.staple-token--bad')).toHaveCount(2);

    // 超出书脊：实测出现 301（> 书脊长度 300）
    await fillStaple(page, {
      planned: '30, 100',
      measured: '-5, 30, 301',
    });
    await page.getByTestId('staple-analyze').click();
    const rangeItems = page.getByTestId('staple-invalid-item');
    await expect(rangeItems).toHaveCount(2);
    await expect(rangeItems.nth(0)).toContainText('第 1 项');
    await expect(rangeItems.nth(0)).toContainText('超出书脊');
    await expect(rangeItems.nth(1)).toContainText('第 3 项');
    await expect(rangeItems.nth(1)).toContainText('超出书脊');

    // 参数不完整：只填计划位
    await page.getByTestId('staple-clear').click();
    await page.getByTestId('staple-planned-input').fill('30, 100');
    await page.getByTestId('staple-analyze').click();
    await expect(page.getByTestId('staple-invalid-panel')).toBeVisible();
    await expect(page.getByTestId('staple-result')).toHaveCount(0);
    const incomplete = page.getByTestId('staple-invalid-item');
    await expect(incomplete).toHaveCount(3); // 书脊长度、允许偏差、实测钉痕
    // 焦点定位到第一个问题字段（书脊长度）
    await expect(page.getByTestId('staple-spine-input')).toBeFocused();
  });

  test('与拼版核版、走纸演练的状态隔离：检测前后已有内容不变', async ({ page }) => {
    // 先建立拼版状态：N=8，第 1 张翻到背面
    await page.getByTestId('pages-input').fill('8');
    const cards = page.getByTestId('sheet-card');
    await expect(cards).toHaveCount(2);
    await cards.nth(0).getByTestId('show-back').click();
    await expect(cards.nth(0).getByTestId('current-side')).toHaveText('背面');

    // 建立走纸演练轨迹：旋转 + 翻纸
    await page.getByTestId('drill-rotate').click();
    await page.getByTestId('drill-flip').click();
    await expect(page.getByTestId('drill-count')).toHaveText('2');
    await expect(page.getByTestId('drill-face')).toHaveText('背面朝上');

    // 做一次钉位检测（混合漏钉/多痕）
    await fillStaple(page, MIXED);
    await page.getByTestId('staple-analyze').click();
    await expect(page.getByTestId('staple-result')).toBeVisible();
    await expect(page.getByTestId('staple-summary-missing')).toHaveText('2');

    // 检测后：拼版结果、翻面状态完全不变
    await expect(page.getByTestId('summary-pages')).toHaveText('8');
    await expect(page.getByTestId('summary-sheets')).toHaveText('2');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).getByTestId('current-side')).toHaveText('背面');
    await expect(cards.nth(0).getByTestId('page-left')).toContainText('2');
    await expect(cards.nth(0).getByTestId('page-right')).toContainText('7');
    await expect(cards.nth(1).getByTestId('current-side')).toHaveText('正面');
    await expect(cards.nth(1).getByTestId('page-left')).toContainText('6');

    // 检测后：演练轨迹与姿态完全不变
    await expect(page.getByTestId('drill-count')).toHaveText('2');
    await expect(page.getByTestId('drill-step')).toHaveCount(2);
    await expect(page.getByTestId('drill-face')).toHaveText('背面朝上');
    await expect(page.getByTestId('drill-arrow')).toHaveText('西');

    // 清空检测同样不影响另外两区
    await page.getByTestId('staple-clear').click();
    await expect(page.getByTestId('staple-result')).toHaveCount(0);
    await expect(page.getByTestId('summary-pages')).toHaveText('8');
    await expect(cards.nth(0).getByTestId('current-side')).toHaveText('背面');
    await expect(page.getByTestId('drill-count')).toHaveText('2');
    await expect(page.getByTestId('drill-face')).toHaveText('背面朝上');
  });

  test('反向隔离：改变拼版输入不撤销、不改写钉位诊断', async ({ page }) => {
    await fillStaple(page, MIXED);
    await page.getByTestId('staple-analyze').click();
    await expect(page.getByTestId('staple-result')).toBeVisible();

    // 修改拼版总页数（含翻面重置）不影响钉位诊断
    await page.getByTestId('pages-input').fill('12');
    await expect(page.getByTestId('summary-pages')).toHaveText('12');
    await expect(page.getByTestId('staple-result')).toBeVisible();
    await expect(page.getByTestId('staple-summary-pairs')).toHaveText('2');
    await expect(page.getByTestId('staple-summary-missing')).toHaveText('2');

    // 演练操作也不影响钉位诊断
    await page.getByTestId('drill-rotate').click();
    await expect(page.getByTestId('drill-count')).toHaveText('1');
    await expect(page.getByTestId('staple-result')).toBeVisible();
    await expect(page.getByTestId('staple-verdict')).toHaveAttribute('data-pass', 'false');
  });

  test('超过安全整数范围的书脊长度：合法原值全程保留并判定合格', async ({ page }) => {
    // 9007199254740993 = 2^53+1，双精度会静默舍入成 9007199254740992。
    const HUGE = '9007199254740993';
    await fillStaple(page, {
      spineLength: HUGE,
      tolerance: '3',
      planned: `0, ${HUGE}`,
      measured: `0, ${HUGE}`,
    });
    await page.getByTestId('staple-analyze').click();

    await expect(page.getByTestId('staple-result')).toBeVisible();
    await expect(page.getByTestId('staple-invalid-panel')).toHaveCount(0);
    await expect(page.getByTestId('staple-verdict')).toHaveAttribute('data-pass', 'true');
    // 连线图底端标尺与钉位标签保留精确原值，未被改小
    const diagram = page.getByTestId('staple-diagram');
    await expect(diagram).toContainText(`${HUGE} mm（底端）`);
    const rows = page.getByTestId('staple-pair-row');
    await expect(rows.nth(1)).toContainText(HUGE);
    await expect(page.getByTestId('staple-summary-cost')).toHaveText('0');
  });

  test('两个严格递增的大整数计划位被接受并参与配对', async ({ page }) => {
    // 9007199254740995 与 9007199254740996 数学上严格递增，
    // 但双精度把二者舍入成同一个数，旧逻辑误判“重复”。
    await fillStaple(page, {
      spineLength: '100000000000000000000',
      tolerance: '3',
      planned: '9007199254740995, 9007199254740996',
      measured: '9007199254740995, 9007199254740996',
    });
    await page.getByTestId('staple-analyze').click();
    await expect(page.getByTestId('staple-result')).toBeVisible();
    await expect(page.getByTestId('staple-invalid-panel')).toHaveCount(0);
    await expect(page.getByTestId('staple-verdict')).toHaveAttribute('data-pass', 'true');
    await expect(page.getByTestId('staple-summary-pairs')).toHaveText('2');
    await expect(page.getByTestId('staple-pair-row')).toHaveCount(2);
  });

  test('超大容差下末端完全吻合：选择末位匹配并显示精确总代价', async ({ page }) => {
    // 计划 2^53+1 / 2^53+3，实测仅 2^53+3（与末端严格相等）。
    // 正确 DP：末位 0 偏差配对 + 漏首位（罚两倍容差）；旧双精度逻辑会
    // 错配首位并把总代价显示成 Infinity。
    const hugeTolerance = '1000000000000000000000000000000000000';
    await fillStaple(page, {
      spineLength: '100000000000000000000000',
      tolerance: hugeTolerance,
      planned: '9007199254740993, 9007199254740995',
      measured: '9007199254740995',
    });
    await page.getByTestId('staple-analyze').click();
    await expect(page.getByTestId('staple-result')).toBeVisible();

    // 唯一配对是「第 2 个计划位 → 第 1 痕」，偏差 0、合格
    const rows = page.getByTestId('staple-pair-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0)).toContainText('第 2 个');
    await expect(rows.nth(0)).toContainText('第 1 痕');
    await expect(rows.nth(0).getByTestId('staple-pair-deviation')).toContainText('0');
    await expect(rows.nth(0).getByTestId('staple-pair-status')).toHaveText('合格');

    // 首位计划位漏钉
    const missingRows = page.getByTestId('staple-missing-row');
    await expect(missingRows).toHaveCount(1);
    await expect(missingRows.nth(0)).toContainText('第 1 个计划位');
    await expect(page.getByTestId('staple-summary-missing')).toHaveText('1');

    // 总代价 = 两倍容差（精确大整数），不再是 Infinity
    await expect(page.getByTestId('staple-summary-cost')).toHaveText(
      '2000000000000000000000000000000000000',
    );
  });
});
