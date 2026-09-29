/**
 * RADAR UI kit — "Field Station" neo-brutalism.
 * Import from "@/components/ui". Every export here is safe in Server Components; the ones marked
 * (client) are client components and can still be rendered from a server page.
 * Live showcase: /styleguide.
 */

export { cn } from "./cn";
export * from "./format";
export * from "./status";
export * from "./geometry";
export * from "./url";
export { Icon, ICON_NAMES, type IconName, type IconProps } from "./icons";

export { AsOf, type AsOfProps } from "./AsOf";
export { Badge, type BadgeProps } from "./Badge";
export { Button, buttonClasses, PendingBlocks, type ButtonProps, type ButtonSize, type ButtonVariant, type ButtonAsButton, type ButtonAsLink } from "./Button";
export { Card, CardBody, CardFooter, CardHeader, type CardProps } from "./Card";
export { ChoiceChip, Checkbox, Toggle, type CheckboxProps, type ChoiceChipProps, type ToggleProps } from "./Checkbox";
export { ClientTabs, type ClientTab, type ClientTabsProps } from "./ClientTabs"; // (client)
export { ConfidenceMeter, LowConfTag, confidenceSurface, type ConfidenceMeterProps } from "./ConfidenceMeter";
export { Drawer, DrawerButton, type DrawerButtonProps, type DrawerProps } from "./Drawer"; // (client)
export { EmptyState, type EmptyStateProps } from "./EmptyState";
export { EstimateTag, type EstimateTagProps } from "./EstimateTag";
export { Field, Fieldset, type FieldControlProps, type FieldProps } from "./Field";
export { FilterChip, FilterChipRow, type FilterChipProps } from "./FilterChip";
export { FitGauge, type FitGaugeProps } from "./FitGauge";
export { CONTROL, Input, Select, Textarea, type InputProps, type SelectOption, type SelectProps, type TextareaProps } from "./Input";
export { KeyValue, Unknown, type KeyValueItem, type KeyValueProps } from "./KeyValue";
export { MethodTag, type MethodTagProps } from "./MethodTag";
export { Modal, ModalButton, type ModalButtonProps, type ModalProps } from "./Modal"; // (client)
export { Notice, type NoticeKind, type NoticeProps } from "./Notice";
export { Pagination, type PaginationProps } from "./Pagination";
export { ProgressBlocks, type ProgressBlocksProps } from "./ProgressBlocks";
export { RadarSweep, type RadarBlip, type RadarSweepProps } from "./RadarSweep";
export { Receipt, type ReceiptProps, type ReceiptRow } from "./Receipt";
export { SectionHeader, type SectionHeaderProps } from "./SectionHeader";
export { Skeleton, SkeletonCard, type SkeletonProps } from "./Skeleton";
export { MiniBars, Sparkline, type MiniBarsProps, type SparklineProps } from "./Sparkline";
export { Stamp, type StampProps, type StampSize } from "./Stamp";
export { StatBlock, type StatBlockProps } from "./StatBlock";
export { Sticker, type StickerProps } from "./Sticker";
export { SubmitButton, type SubmitButtonProps } from "./SubmitButton"; // (client)
export { SvgDefs } from "./SvgDefs";
export {
  DataTable,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  type Column,
  type DataTableProps,
  type MobileRole,
  type SortState,
} from "./Table";
export { LinkTabs, TabCount, tabClasses, type LinkTab, type LinkTabsProps } from "./Tabs";
export { Ticker, type TickerItem, type TickerProps } from "./Ticker";
export { Timeline, type TimelineEntry, type TimelineProps } from "./Timeline";
export { FlashToast, ToastProvider, useToast, type ToastInput, type ToastKind } from "./Toast"; // (client)
export { InfoTip, Tooltip, type TooltipProps } from "./Tooltip"; // (client)
export { useDialog, useDisclosure } from "./useDialog"; // (client hooks)
export { Wordmark, type WordmarkProps } from "./Wordmark";
