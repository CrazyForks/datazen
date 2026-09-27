export { cn } from './cn';
export { tid, type TidAttrs } from './tid';
export { Button, type ButtonProps } from './Button';
export { Input, type InputProps } from './Input';
export {
  Select,
  defaultSelectLabels,
  type SelectOption,
  type SelectProps,
  type SelectLabels,
} from './Select';
// The `data-*` passthrough contract itself (see docs/architecture/frontend/components.md §9.1).
// Exported so the other closed-prop components can implement the *same* contract
// from outside this package rather than re-declaring it locally.
export {
  splitDataAttrs,
  type DataAttrProps,
  type SplitDataAttrs,
} from './dataAttrs';
export { Dialog, type DialogProps } from './Dialog';
export { Tabs, type TabItem, type TabsProps } from './Tabs';
export { Badge, type BadgeProps } from './Badge';
export { Label, type LabelProps } from './Label';
export { Slider, type SliderProps } from './Slider';
export {
  TemporalValueInput,
  type TemporalValueInputProps,
  type TemporalPickerKind,
} from './TemporalValueInput';
export { PathInput, type PathInputProps } from './PathInput';
export { ToolbarShell, type ToolbarShellProps } from './ToolbarShell';
export { ToolbarButton, type ToolbarButtonProps } from './ToolbarButton';
export { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';
export { CopyableError, type CopyableErrorProps } from './CopyableError';
export { ResultMessageDialog, type ResultMessageDialogProps } from './ResultMessageDialog';
export { LimitationsDialog, type LimitationsDialogProps } from './LimitationsDialog';
// The ONE i18n implementation shared by host, drivers and extensions.
export {
  setLocale,
  getLocale,
  registerTranslations,
  getRegisteredTranslations,
  t,
  useI18n,
  type I18nParams,
} from './i18n';
