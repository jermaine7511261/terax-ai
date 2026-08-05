//! Locks the project-wide invariant: a poisoned Mutex/RwLock must never abort
//! the process. Every lock site uses `.unwrap_or_else(|e| e.into_inner())`
//! (round 9, P5), which recovers the guard and keeps running. Regression guard:
//! reintroducing `.lock().unwrap()` anywhere breaks `pnpm verify`'s poison gate.

use std::sync::{Arc, Mutex, RwLock};

#[test]
fn poisoned_mutex_recovers_guard_data() {
    let lock = Arc::new(Mutex::new(42u32));
    let _ = std::panic::catch_unwind(|| {
        let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        panic!("intentional poison");
    });
    assert!(lock.is_poisoned());
    let value = *lock.lock().unwrap_or_else(|e| e.into_inner());
    assert_eq!(value, 42);
}

#[test]
fn poisoned_rwlock_recovers_read_and_write_guards() {
    let lock = Arc::new(RwLock::new(vec![1, 2, 3]));
    let _ = std::panic::catch_unwind(|| {
        let _guard = lock.write().unwrap_or_else(|e| e.into_inner());
        panic!("intentional poison");
    });
    assert!(lock.is_poisoned());
    let read = lock.read().unwrap_or_else(|e| e.into_inner());
    assert_eq!(read.len(), 3);
    drop(read);
    let mut write = lock.write().unwrap_or_else(|e| e.into_inner());
    write.push(4);
    assert_eq!(write.len(), 4);
}
