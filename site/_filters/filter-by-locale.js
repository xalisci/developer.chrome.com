const {defaultLocale} = require('../_data/site.json');

/**
 * Filters Front Matter data that have the same locale attribute as requested.
 * @param {FrontMatterData[]} fMData An array of Front Matter data.
 * @param {string} [locale] Target locale.
 * @return {FrontMatterData[]}
 */
module.exports = function filterByLocale(fMData, locale = defaultLocale) {
  /** @type {Map<string, FrontMatterData>} */
  const filteredFrontMatter = new Map();
  for (const element of fMData) {
    if (filteredFrontMatter.has(element.url) && element.locale === locale) {
      filteredFrontMatter.set(element.url, element);
    } else if (
      !filteredFrontMatter.has(element.url) &&
      [locale, defaultLocale].includes(element.locale)
    ) {
      filteredFrontMatter.set(element.url, element);
    }
  }
  return Array.from(filteredFrontMatter.values()).sort(
    (a, b) => b.date.getTime() - a.date.getTime()
  );
};
