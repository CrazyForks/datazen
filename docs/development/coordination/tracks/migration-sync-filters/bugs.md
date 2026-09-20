# Bugs and boundaries

- Filters are intentionally symmetric across the matched source and target
  columns. A source-only predicate would make target-only rows look like delete
  candidates and could remove rows outside the requested scope.
- The current contract supports same-name columns only. Mapped or renamed key
  columns remain outside this track and must use a later explicit mapping
  contract.
- Filter values remain server-side parameters; preview text uses anonymous
  placeholders and never interpolates user values.
