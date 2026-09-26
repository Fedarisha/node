import { z } from 'zod';

// The panel uses the decimal database ID for users since upstream removed
// user.uuid. Keep UUIDs valid for requests from older panel deployments.
export const FedarishaUserKeySchema = z.union([
    z.string().regex(/^[1-9][0-9]*$/),
    z.string().uuid(),
]);
