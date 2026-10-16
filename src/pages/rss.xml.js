import rss from '@astrojs/rss';
import articles from '../data/articles.json';
export function GET(context){return rss({title:'Журнал Лікар Поруч',description:'Практичні матеріали про здоров’я українською',site:context.site,items:articles.map(a=>({title:a.title,description:a.description,pubDate:new Date(a.published),link:`/likar-poruch/zhurnal/${a.slug}/`})),customData:'<language>uk-UA</language>'});}
