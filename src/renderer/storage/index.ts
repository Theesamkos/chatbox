import StoreStorage, { StorageKey } from './StoreStorage'

const storage = new StoreStorage()

// Flush any pending debounced writes before the page unloads so data is not lost
// when the user closes the tab or navigates away mid-debounce.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    storage.flushAll()
  })
}

export default storage
export { StorageKey }
