import { buildWiseProfileComplianceTabsProps } from './build-wise-profile-compliance-tabs-props';
import { buildWiseProfileCoreTabsProps } from './build-wise-profile-core-tabs-props';
import type {
  BuildWiseProfileTabsPropsOptions,
  WiseProfileTabsProps,
} from './wise-profile-tabs-props-types';

export function buildWiseProfileTabsProps(
  options: BuildWiseProfileTabsPropsOptions,
): WiseProfileTabsProps {
  const coreTabsProps = buildWiseProfileCoreTabsProps(options);
  const complianceTabsProps = buildWiseProfileComplianceTabsProps(options);

  return {
    ...coreTabsProps,
    ...complianceTabsProps,
  };
}
