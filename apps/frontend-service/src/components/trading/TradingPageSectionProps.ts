import {
  buildTradingDialogsSectionProps,
  buildTradingLayoutSectionProps,
  buildTradingOperationalTabsSectionProps,
  buildTradingPrimaryTabsSectionProps,
} from './TradingSectionPropsBuilders';

type PrimaryTabsOptions = Parameters<typeof buildTradingPrimaryTabsSectionProps>[0];
type OperationalTabsOptions = Parameters<typeof buildTradingOperationalTabsSectionProps>[0];
type DialogsOptions = Parameters<typeof buildTradingDialogsSectionProps>[0];
type LayoutOptions = Parameters<typeof buildTradingLayoutSectionProps>[0];

export type BuildTradingPageSectionPropsOptions = {
  dialogsOptions: DialogsOptions;
  layoutOptions: LayoutOptions;
  operationalTabsOptions: OperationalTabsOptions;
  primaryTabsOptions: PrimaryTabsOptions;
};

export function buildTradingPageSectionProps({
  dialogsOptions,
  layoutOptions,
  operationalTabsOptions,
  primaryTabsOptions,
}: BuildTradingPageSectionPropsOptions) {
  const { primaryTabsSectionProps } = buildTradingPrimaryTabsSectionProps(primaryTabsOptions);
  const { operationalTabsSectionProps } = buildTradingOperationalTabsSectionProps(operationalTabsOptions);
  const { dialogsSectionProps } = buildTradingDialogsSectionProps(dialogsOptions);
  const {
    headerSectionProps,
    operationalAlertsSectionProps,
    statsPrimarySectionProps,
    statsSecondarySectionProps,
    tabsShellSectionProps,
  } = buildTradingLayoutSectionProps(layoutOptions);

  return {
    dialogsSectionProps,
    headerSectionProps,
    operationalAlertsSectionProps,
    operationalTabsSectionProps,
    primaryTabsSectionProps,
    statsPrimarySectionProps,
    statsSecondarySectionProps,
    tabsShellSectionProps,
  };
}
