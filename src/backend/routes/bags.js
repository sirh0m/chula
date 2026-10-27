import { Router } from 'express';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';

export const DISTRICTS = ['Ntinda', 'Kololo', 'Bugolobi', 'Nakasero'];

export function createBagsRouter({ store }) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const district = req.query.district ? String(req.query.district) : undefined;
      if (district && !DISTRICTS.includes(district)) {
        throw badRequest(`District must be one of ${DISTRICTS.join(', ')}`);
      }
      const bags = await store.listBags({ district });
      res.set('Cache-Control', 'no-store').json({ bags, districts: DISTRICTS });
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const bag = await store.getBag(req.params.id);
      if (!bag) throw notFound('That bag no longer exists');
      res.json({ bag });
    }),
  );

  return router;
}
