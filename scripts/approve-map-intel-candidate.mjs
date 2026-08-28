import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { approveMapIntelCandidate } from './map-intel-review.mjs'

const root = path.join(fileURLToPath(import.meta.url), '..', '..')
approveMapIntelCandidate(path.join(root, 'assets', 'lodes', 'map-intel.json'))
