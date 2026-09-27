// Rewrites the "Scout housing search" page in GBrain from local learned state.
import { syncGbrainPage } from '../src/lib/memory/providers'

syncGbrainPage().then(() => console.log('GBrain page synced'))
