import rss from '@astrojs/rss';
import articles from '../data/articles.json';

export function GET(context) {
  return rss({
    title: 'Журнал Лікар Поруч',
    description: 'Практичні матеріали про здоров’я українською',
    site: new URL(import.meta.env.BASE_URL, context.site),
    items: articles.map((article) => ({
      title: article.title,
      description: article.description,
      pubDate: new Date(article.published),
      link: `/likar-poruch/zhurnal/${article.slug}/`,
    })),
    customData: '<language>uk-UA</language>',
  });
}
