import { type ComponentProps } from 'react';
import { motion } from 'framer-motion';
import { itemVariants } from './TradingDomainTypes';
import { TradingDialogsSection } from './TradingDialogsSection';
import { TradingOperationalTabsSection } from './TradingOperationalTabsSection';
import { TradingOperationalAlerts } from './TradingOperationalAlerts';
import { TradingPrimaryTabsSection } from './TradingPrimaryTabsSection';
import { TradingHeaderSection } from './TradingHeaderSection';
import { TradingTabsShell } from './TradingTabsShell';
import { TradingStatsPrimaryRow, TradingStatsSecondaryRow } from './TradingStatsRows';

type TradingOperationalAlertsSectionProps = ComponentProps<typeof TradingOperationalAlerts>;
type TradingHeaderSectionProps = ComponentProps<typeof TradingHeaderSection>;
type TradingStatsPrimarySectionProps = ComponentProps<typeof TradingStatsPrimaryRow>;
type TradingStatsSecondarySectionProps = ComponentProps<typeof TradingStatsSecondaryRow>;
type TradingTabsShellSectionProps = Omit<ComponentProps<typeof TradingTabsShell>, 'children'>;
type TradingPrimaryTabsSectionProps = ComponentProps<typeof TradingPrimaryTabsSection>;
type TradingOperationalTabsSectionProps = ComponentProps<typeof TradingOperationalTabsSection>;
type TradingDialogsSectionProps = ComponentProps<typeof TradingDialogsSection>;

type TradingPageSectionsProps = {
  dialogsSectionProps: TradingDialogsSectionProps;
  headerSectionProps: TradingHeaderSectionProps;
  operationalAlertsSectionProps: TradingOperationalAlertsSectionProps;
  operationalTabsSectionProps: TradingOperationalTabsSectionProps;
  primaryTabsSectionProps: TradingPrimaryTabsSectionProps;
  showOperationalAlerts: boolean;
  statsPrimarySectionProps: TradingStatsPrimarySectionProps;
  statsSecondarySectionProps: TradingStatsSecondarySectionProps;
  tabsShellSectionProps: TradingTabsShellSectionProps;
};

export function TradingPageSections({
  dialogsSectionProps,
  headerSectionProps,
  operationalAlertsSectionProps,
  operationalTabsSectionProps,
  primaryTabsSectionProps,
  showOperationalAlerts,
  statsPrimarySectionProps,
  statsSecondarySectionProps,
  tabsShellSectionProps,
}: TradingPageSectionsProps) {
  return (
    <>
      {showOperationalAlerts ? (
        <motion.div variants={itemVariants}>
          <TradingOperationalAlerts {...operationalAlertsSectionProps} />
        </motion.div>
      ) : null}

      <motion.div variants={itemVariants}>
        <TradingHeaderSection {...headerSectionProps} />
      </motion.div>

      <motion.div variants={itemVariants}>
        <TradingStatsPrimaryRow {...statsPrimarySectionProps} />
      </motion.div>

      <motion.div variants={itemVariants}>
        <TradingStatsSecondaryRow {...statsSecondarySectionProps} />
      </motion.div>

      <motion.div variants={itemVariants}>
        <TradingTabsShell {...tabsShellSectionProps}>
          <TradingPrimaryTabsSection {...primaryTabsSectionProps} />
          <TradingOperationalTabsSection {...operationalTabsSectionProps} />
        </TradingTabsShell>
      </motion.div>

      <TradingDialogsSection {...dialogsSectionProps} />
    </>
  );
}
