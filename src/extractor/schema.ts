import { z } from 'zod';

export const ExtractionSchema = z.object({
  decisions: z.array(z.object({
    what: z.string().min(1),
    rationale: z.string(),
    decided_by: z.string(),
  })),
  commitments: z.array(z.object({
    owner: z.string().min(1),
    task: z.string().min(1),
    deadline: z.string().nullable(),
  })),
});

export type Extraction = z.infer<typeof ExtractionSchema>;
