import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const projects = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    order: z.number(),
    label: z.string(),
    line: z.string(),
    tags: z.array(z.string()),
    status: z.string(),
    stack: z.string(),
    link: z.object({ href: z.url(), text: z.string() }).optional(),
  }),
});

export const collections = { projects };
