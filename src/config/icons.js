// Centralized icon registry for PowerDARS
//
// To use image files instead of emojis:
//   1. Add the image to assets/icons/ with the filename shown in the comment
//   2. Uncomment the require() line and delete the emoji string
//
// assets/icons/ filenames:
//   bank.png, investment.png, credit.png, loan.png, car.png,
//   phone.png, utility.png, subscription.png, other.png,
//   income.png, bills.png, reminder.png, personal.png, wireless.png

export const ICONS = {
  // ── Account types ────────────────────────────────────────────────────────
  checking:     '🏦',   // require('../../assets/icons/bank.png')
  savings:      '💰',   // require('../../assets/icons/bank.png')
  investment:   '📈',   // require('../../assets/icons/investment.png')
  credit:       '💳',   // require('../../assets/icons/credit.png')
  loan:         '🏠',   // require('../../assets/icons/loan.png')
  car_lease:    '🚗',   // require('../../assets/icons/car.png')
  car_insurance:'🛡️',   // require('../../assets/icons/car.png')
  phone:        '📞',   // require('../../assets/icons/phone.png')
  utility:      '💡',   // require('../../assets/icons/utility.png')
  subscription: '📱',   // require('../../assets/icons/subscription.png')
  other:        '📄',   // require('../../assets/icons/other.png')

  // ── Bill / event categories ──────────────────────────────────────────────
  bills:        '📄',   // require('../../assets/icons/bills.png')
  income:       '💰',   // require('../../assets/icons/income.png')
  reminder:     '🔔',   // require('../../assets/icons/reminder.png')
  personal:     '💜',   // require('../../assets/icons/personal.png')
  wireless:     '📶',   // require('../../assets/icons/wireless.png')
};
