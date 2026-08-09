//! Research budget ledger (P3, fira reserve/refund +  parallel 预算预占).
//! Pure accounting: a `ResearchBudget` tracks reserved vs spent quota. The
//! deep_search run reserves per-worker quota up front (parallel), and cheap
//! workers refund their unused reservation so the pool isn't over-committed.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BudgetOutcome {
    Reserved,
    Exhausted,
}

#[derive(Debug, Clone)]
pub struct ResearchBudget {
    cap: u64,
    reserved: u64,
    spent: u64,
}

impl ResearchBudget {
    pub fn new(cap: u64) -> Self {
        Self {
            cap,
            reserved: 0,
            spent: 0,
        }
    }

    /// Reserve `amount` up front. Refused when it would exceed the cap.
    pub fn reserve(&mut self, amount: u64) -> BudgetOutcome {
        if self.reserved + amount > self.cap {
            return BudgetOutcome::Exhausted;
        }
        self.reserved += amount;
        BudgetOutcome::Reserved
    }

    /// Move a reservation to spent (actual usage).
    pub fn commit(&mut self, amount: u64) -> u64 {
        let actual = amount.min(self.reserved);
        self.spent += actual;
        self.reserved -= actual;
        actual
    }

    /// Release an unused reservation back to the pool.
    pub fn refund(&mut self, amount: u64) {
        let actual = amount.min(self.reserved);
        self.reserved -= actual;
    }

    pub fn available(&self) -> u64 {
        self.cap.saturating_sub(self.spent + self.reserved)
    }

    pub fn spent(&self) -> u64 {
        self.spent
    }

    /// Remaining reservation+spent as a fraction 0..1 for the poll status.
    pub fn usage_ratio(&self) -> f64 {
        if self.cap == 0 {
            return 0.0;
        }
        (self.spent + self.reserved) as f64 / self.cap as f64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserve_commit_refund_flow() {
        let mut b = ResearchBudget::new(100);
        assert_eq!(b.reserve(40), BudgetOutcome::Reserved);
        assert_eq!(b.reserve(40), BudgetOutcome::Reserved);
        assert_eq!(b.reserve(40), BudgetOutcome::Exhausted); // 80 + 40 > 100
        assert_eq!(b.spent(), 0);

        // Commit 25 of the first 40.
        assert_eq!(b.commit(25), 25);
        assert_eq!(b.spent(), 25);
        // Refund the rest of that reservation.
        b.refund(15);
        assert_eq!(b.available(), 100 - 25 - 40); // cap - spent - reserved
    }

    #[test]
    fn commit_caps_at_reservation() {
        let mut b = ResearchBudget::new(50);
        b.reserve(10);
        assert_eq!(b.commit(999), 10); // can't commit more than reserved
        assert_eq!(b.spent(), 10);
    }

    #[test]
    fn refund_caps_at_reservation() {
        let mut b = ResearchBudget::new(50);
        b.reserve(10);
        b.refund(999);
        assert_eq!(b.available(), 50);
    }

    #[test]
    fn usage_ratio() {
        let mut b = ResearchBudget::new(100);
        assert_eq!(b.usage_ratio(), 0.0);
        b.reserve(50);
        assert_eq!(b.usage_ratio(), 0.5);
    }
}
