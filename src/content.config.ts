import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { file } from 'astro/loaders';

const withSlugIds = (text: string) => {
  const entries = JSON.parse(text) as Array<Record<string, unknown> & { slug: string }>;
  return entries.map((entry) => ({ id: entry.slug, ...entry }));
};

const doctors = defineCollection({
  loader: file('src/data/doctors.json', { parser: withSlugIds }),
  schema: z.object({
    slug: z.string().min(1),
    name: z.string().min(2),
    initials: z.string().min(1),
    specialty: z.string().min(2),
    specialtySlug: z.string().min(1),
    city: z.string().min(2),
    citySlug: z.string().min(1),
    experience: z.string().min(2),
    languages: z.array(z.string()).min(1),
    focus: z.array(z.string()).min(1),
    format: z.string().min(2),
    bio: z.string().min(20),
    accent: z.enum(['blue', 'yellow', 'coral', 'mint', 'lilac', 'navy'])
  })
});

const articles = defineCollection({
  loader: file('src/data/articles.json', { parser: withSlugIds }),
  schema: z.object({
    slug: z.string().min(1),
    title: z.string().min(10),
    description: z.string().min(30),
    category: z.string().min(2),
    readingTime: z.string().min(2),
    published: z.iso.date(),
    updated: z.iso.date(),
    author: z.string().min(2),
    reviewer: z.string().min(2),
    intro: z.string().min(30),
    sections: z.array(z.object({
      heading: z.string().min(3),
      text: z.string().min(20)
    })).min(2)
  })
});

export const collections = { doctors, articles };
