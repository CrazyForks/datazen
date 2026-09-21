# Bugs — redis-pr3-collection-editors

## BUG-001: ListEditor delete button always pops from left

- **Status**: 待修复
- **Severity**: Medium — functional defect
- **Description**: In `ListEditor.tsx`, the per-row delete button (Trash2 icon) calls `invokeListPop(dbSessionId, dbIndex, detail.key, 'left')` for every row. This always removes the **first** element of the list (LPOP), regardless of which row the user clicked. The expected behavior is to remove the element at the clicked row's index (`offset + index`).
- **Root cause**: No `invokeListDelByIndex` function exists; Redis has no native "delete by index" command. The correct approach would be to use `LSET` to mark the target element, then `LREM` to remove it, or to reconstruct the list without the target element.
- **Reproduction**: Open any Redis LIST key with multiple elements. Click the delete (🗑) button on the 3rd row. Observe that the 1st element is removed instead of the 3rd.
- **Impact**: User intending to delete element at index N always deletes element at index 0. On subsequent clicks, wrong elements are removed sequentially.
- **File**: `packages/drivers/redis/ui/ListEditor.tsx` line 133
