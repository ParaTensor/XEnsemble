import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  consoleToolPageClass,
  consoleDialogPanelClass,
  consoleTableShellClass,
  consolePageTitleClass,
  consoleTableBodyDivideClass,
  bgCanvas,
  bgContainer,
  bgSecondary,
  bgTertiary,
  bgActive,
  bgInverse,
  textPrimary,
  textSecondary,
  textTertiary,
  textPlaceholder,
  textInverse,
  borderHairline,
  borderSubtle,
  divideHairline,
  accentBlue,
  accentBlueBg,
  accentRed,
  accentRedBg,
  accentGreen,
  accentGreenBg,
  accentGreenText,
  panelPadding,
  headerPadding,
  compactRadius,
  containerRadius,
  transitionBase,
  hoverBgSecondary,
  hoverBgCanvas,
  hoverBgTertiary,
  hoverBgActive,
  hoverTextPrimary,
  hoverTextSecondary,
} from './consoleTheme.js';

describe('consoleTheme tokens', () => {
  it('exports page background as light Morandi', () => {
    assert.match(consoleToolPageClass, /bg-\[#F7F8F9\]/);
    assert.match(consoleToolPageClass, /text-\[#202124\]/);
  });

  it('exports dialog panel as light with border width', () => {
    assert.match(consoleDialogPanelClass, /bg-\[#FFFFFF\]/);
    assert.match(consoleDialogPanelClass, /\bborder\b/);
    assert.match(consoleDialogPanelClass, /border-\[#E8EAED\]/);
  });

  it('exports table shell as light with border width', () => {
    assert.match(consoleTableShellClass, /bg-\[#FFFFFF\]/);
    assert.match(consoleTableShellClass, /\bborder\b/);
    assert.match(consoleTableShellClass, /border-\[#E8EAED\]/);
  });

  it('exports page title using primary text', () => {
    assert.match(consolePageTitleClass, /text-\[#202124\]/);
  });

  it('exports background primitive tokens', () => {
    assert.strictEqual(bgCanvas, 'bg-[#FFFFFF]');
    assert.strictEqual(bgContainer, 'bg-[#F7F8F9]');
    assert.strictEqual(bgSecondary, 'bg-[#F4F5F6]');
    assert.strictEqual(bgTertiary, 'bg-[#FAFBFC]');
    assert.strictEqual(bgActive, 'bg-[#E8EAED]');
    assert.strictEqual(bgInverse, 'bg-[#202124]');
  });

  it('exports text primitive tokens', () => {
    assert.strictEqual(textPrimary, 'text-[#202124]');
    assert.strictEqual(textSecondary, 'text-[#5F6368]');
    assert.strictEqual(textTertiary, 'text-[#3C4043]');
    assert.strictEqual(textPlaceholder, 'text-[#9AA0A6]');
    assert.strictEqual(textInverse, 'text-white');
  });

  it('exports border and divide primitive tokens', () => {
    assert.strictEqual(borderHairline, 'border-[#E8EAED]');
    assert.strictEqual(borderSubtle, 'border-[#DADCE0]');
    assert.strictEqual(divideHairline, 'divide-[#E8EAED]');
  });

  it('exports accent tokens', () => {
    assert.match(accentBlue, /#5B8DB8/);
    assert.match(accentRed, /#C06C5D/);
  });

  it('exports remaining primitive tokens', () => {
    assert.strictEqual(bgSecondary, 'bg-[#F4F5F6]');
    assert.match(accentBlueBg, /#5B8DB8/);
    assert.match(accentGreen, /#4A7C59/);
    assert.strictEqual(accentGreenBg, 'bg-[#E8F5E9]');
    assert.strictEqual(accentGreenText, 'text-[#4A7C59]');
    assert.match(accentRedBg, /#FDECEA/);
    assert.strictEqual(panelPadding, 'p-3');
    assert.strictEqual(headerPadding, 'px-3 py-2');
    assert.strictEqual(compactRadius, 'rounded-lg');
    assert.strictEqual(containerRadius, 'rounded-2xl');
    assert.strictEqual(transitionBase, 'transition-colors duration-150 ease-in-out');
  });

  it('exports static hover primitive tokens for Tailwind JIT compatibility', () => {
    assert.strictEqual(hoverBgSecondary, 'hover:bg-[#F4F5F6]');
    assert.strictEqual(hoverBgCanvas, 'hover:bg-[#FFFFFF]');
    assert.strictEqual(hoverBgTertiary, 'hover:bg-[#FAFBFC]');
    assert.strictEqual(hoverBgActive, 'hover:bg-[#E8EAED]');
    assert.strictEqual(hoverTextPrimary, 'hover:text-[#202124]');
    assert.strictEqual(hoverTextSecondary, 'hover:text-[#5F6368]');
  });

  it('uses divideHairline in table body divider', () => {
    assert.strictEqual(consoleTableBodyDivideClass, `divide-y ${divideHairline}`);
  });
});
