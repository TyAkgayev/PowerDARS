import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Modal, TextInput, Alert, Platform, useWindowDimensions,
} from 'react-native';
import { deleteField } from 'firebase/firestore';
import { useApp } from '../context/AppContext';
import { ICONS } from '../config/icons';
import { usePlaidLink } from '../hooks/usePlaidLink';

// react-native-web's Alert.alert is a no-op stub, so on web these dialogs
// must go through window.confirm/alert instead or they silently do nothing.
function confirmAsync(title, message) {
  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise(resolve => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

function notify(title, message) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

const C = {
  primary: '#4361EE',
  primaryLight: '#EEF2FF',
  bg: '#F0F4FF',
  card: '#FFFFFF',
  text: '#1F2937',
  muted: '#6B7280',
  faint: '#9CA3AF',
  border: '#E5E7EB',
  bills: '#EF4444',
  income: '#22C55E',
};

// Banks stay special-cased outside the category system (Plaid linking,
// dashboard balance editing) — everything else is a user-defined category.
const BANK_TYPE_OPTS = [
  { id: 'checking', label: 'Checking', icon: ICONS.checking },
  { id: 'savings',  label: 'Savings',  icon: ICONS.savings },
];

const FIELD_TYPES = [
  { id: 'currency', label: 'Currency ($)' },
  { id: 'number',   label: 'Number' },
  { id: 'text',     label: 'Text' },
  { id: 'percent',  label: 'Percentage (%)' },
  { id: 'date',     label: 'Date' },
];

const PALETTE = ['#3B82F6','#A855F7','#F59E0B','#22C55E','#EF4444','#06B6D4','#EC4899','#8B5CF6'];
const ACCT_COLORS = PALETTE;

const SUGGESTED_BANK_FIELDS = {
  checking: [{ label: 'Balance', type: 'currency' }, { label: 'Available Balance', type: 'currency' }],
  savings:  [{ label: 'Balance', type: 'currency' }],
};

function makeId() {
  return Math.random().toString(36).slice(2, 9);
}

// ─── Field Builder ──────────────────────────────────────────────────────────
// Add/remove {label, type} rows. Used by CategoryModal (defines a category's
// shared fields) and BankAccountModal (banks keep their own per-account
// fields, unchanged from before).
function FieldBuilder({ fields, onChange }) {
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState('currency');

  const addField = () => {
    if (!newFieldLabel.trim()) return;
    onChange([...fields, { id: makeId(), label: newFieldLabel.trim(), type: newFieldType }]);
    setNewFieldLabel('');
    setNewFieldType('currency');
  };

  const removeField = (id) => onChange(fields.filter(f => f.id !== id));

  return (
    <>
      {fields.length === 0 && (
        <Text style={m.emptyFields}>No fields yet. Add fields below.</Text>
      )}
      {fields.map(field => (
        <View key={field.id} style={m.fieldRow}>
          <View style={m.fieldInfo}>
            <Text style={m.fieldName}>{field.label}</Text>
            <Text style={m.fieldType}>{FIELD_TYPES.find(f => f.id === field.type)?.label || field.type}</Text>
          </View>
          <TouchableOpacity onPress={() => removeField(field.id)} style={m.fieldDel}>
            <Text style={m.fieldDelTxt}>×</Text>
          </TouchableOpacity>
        </View>
      ))}
      <View style={m.addFieldRow}>
        <TextInput
          style={[m.input, { flex: 1 }]}
          placeholder="Field name..."
          value={newFieldLabel}
          onChangeText={setNewFieldLabel}
          placeholderTextColor={C.faint}
        />
        <View style={m.fieldTypeSelect}>
          {FIELD_TYPES.map(ft => (
            <TouchableOpacity
              key={ft.id}
              style={[m.ftBtn, newFieldType === ft.id && m.ftBtnActive]}
              onPress={() => setNewFieldType(ft.id)}
            >
              <Text style={[m.ftTxt, newFieldType === ft.id && m.ftTxtActive]}>{ft.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={m.addFieldBtn} onPress={addField}>
          <Text style={m.addFieldTxt}>+ Add</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

// ─── Category Modal ─────────────────────────────────────────────────────────
// A category defines the fields every account assigned to it will track —
// e.g. "Credit Card" -> Balance, Amount Due, APR — set once here instead of
// per account.
function CategoryModal({ visible, onClose, onSave, existing }) {
  const isEdit = !!existing;
  const [name, setName] = useState(existing?.name || '');
  const [icon, setIcon] = useState(existing?.icon || '');
  const [color, setColor] = useState(existing?.color || PALETTE[0]);
  const [fields, setFields] = useState(existing?.fields || []);

  const handleSave = async () => {
    if (!name.trim()) return;
    await onSave({ name: name.trim(), icon: icon || '📂', color, fields });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={m.overlay}>
        <ScrollView contentContainerStyle={m.scrollContent}>
          <View style={m.box}>
            <Text style={m.title}>{isEdit ? 'Edit Category' : 'New Category'}</Text>

            <Text style={m.label}>Category Name</Text>
            <TextInput
              style={m.input}
              placeholder="e.g. Credit Card"
              value={name}
              onChangeText={setName}
              placeholderTextColor={C.faint}
            />

            <Text style={m.label}>Icon (emoji)</Text>
            <TextInput
              style={m.input}
              placeholder="📂"
              value={icon}
              onChangeText={setIcon}
              placeholderTextColor={C.faint}
            />

            <Text style={m.label}>Color</Text>
            <View style={m.colorRow}>
              {PALETTE.map(col => (
                <TouchableOpacity
                  key={col}
                  style={[m.colorSwatch, { backgroundColor: col }, color === col && m.colorSwatchActive]}
                  onPress={() => setColor(col)}
                />
              ))}
            </View>

            <Text style={m.label}>Fields every account in this category tracks</Text>
            <FieldBuilder fields={fields} onChange={setFields} />

            <View style={m.btnRow}>
              <TouchableOpacity style={m.cancelBtn} onPress={onClose}>
                <Text style={m.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={m.saveBtn} onPress={handleSave}>
                <Text style={m.saveTxt}>{isEdit ? 'Save Changes' : 'Create Category'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Bank Account Modal ─────────────────────────────────────────────────────
// Unchanged from before the category rework — banks stay special-cased for
// Plaid linking and keep their own per-account fields.
function BankAccountModal({ visible, onClose, onSave, existing, isMobile }) {
  const isEdit = !!existing;
  const [name, setName] = useState(existing?.name || '');
  const [type, setType] = useState(existing?.type || 'checking');
  const [lastFour, setLastFour] = useState(existing?.lastFour || '');
  const [color, setColor] = useState(existing?.color || PALETTE[0]);
  const [icon, setIcon] = useState(existing?.icon || '');
  const [fields, setFields] = useState(
    existing?.fields || SUGGESTED_BANK_FIELDS.checking.map(f => ({ id: makeId(), ...f }))
  );

  const handleTypeChange = (t) => {
    setType(t);
    const typeInfo = BANK_TYPE_OPTS.find(a => a.id === t);
    if (typeInfo && !isEdit) setIcon(typeInfo.icon);
    if (!isEdit && fields.length === 0) {
      setFields((SUGGESTED_BANK_FIELDS[t] || []).map(f => ({ id: makeId(), ...f })));
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    const typeInfo = BANK_TYPE_OPTS.find(t => t.id === type);
    await onSave({
      kind: 'bank',
      name: name.trim(),
      type,
      lastFour: lastFour.trim() || null,
      color,
      icon: icon || typeInfo?.icon || '🏦',
      fields,
    });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType={isMobile ? 'slide' : 'fade'} onRequestClose={onClose}>
      <View style={[m.overlay, isMobile && m.overlayMobile]}>
        <ScrollView contentContainerStyle={[m.scrollContent, isMobile && m.scrollContentMobile]}>
          <View style={[m.box, isMobile && m.boxMobile]}>
            <Text style={m.title}>{isEdit ? 'Edit Bank Account' : 'Add Bank Account'}</Text>

            <Text style={m.label}>Account Name</Text>
            <TextInput
              style={m.input}
              placeholder="e.g. Chase Checking"
              value={name}
              onChangeText={setName}
              placeholderTextColor={C.faint}
            />

            <Text style={m.label}>Account Type</Text>
            <View style={m.typeGrid}>
              {BANK_TYPE_OPTS.map(t => (
                <TouchableOpacity
                  key={t.id}
                  style={[m.typeBtn, type === t.id && m.typeBtnActive]}
                  onPress={() => handleTypeChange(t.id)}
                >
                  <Text style={m.typeIcon}>{t.icon}</Text>
                  <Text style={[m.typeTxt, type === t.id && m.typeTxtActive]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={m.label}>Last 4 Digits (optional)</Text>
            <TextInput
              style={m.input}
              placeholder="e.g. 5678"
              value={lastFour}
              onChangeText={setLastFour}
              keyboardType="number-pad"
              maxLength={4}
              placeholderTextColor={C.faint}
            />

            <Text style={m.label}>Icon (emoji)</Text>
            <TextInput
              style={m.input}
              placeholder={BANK_TYPE_OPTS.find(t => t.id === type)?.icon || '🏦'}
              value={icon}
              onChangeText={setIcon}
              placeholderTextColor={C.faint}
            />

            <Text style={m.label}>Color</Text>
            <View style={m.colorRow}>
              {PALETTE.map(col => (
                <TouchableOpacity
                  key={col}
                  style={[m.colorSwatch, { backgroundColor: col }, color === col && m.colorSwatchActive]}
                  onPress={() => setColor(col)}
                />
              ))}
            </View>

            <Text style={m.label}>Tracked Fields</Text>
            <FieldBuilder fields={fields} onChange={setFields} />

            <View style={m.btnRow}>
              <TouchableOpacity style={m.cancelBtn} onPress={onClose}>
                <Text style={m.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={m.saveBtn} onPress={handleSave}>
                <Text style={m.saveTxt}>{isEdit ? 'Save Changes' : 'Add Bank Account'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Category Account Modal ─────────────────────────────────────────────────
// For every non-bank account: pick a category instead of building fields —
// the account inherits that category's field schema.
function CategoryAccountModal({ visible, onClose, onSave, existing, isMobile, categories }) {
  const isEdit = !!existing;
  const [name, setName] = useState(existing?.name || '');
  const [categoryId, setCategoryId] = useState(existing?.categoryId || categories[0]?.id || null);
  const [lastFour, setLastFour] = useState(existing?.lastFour || '');
  const [color, setColor] = useState(existing?.color || PALETTE[0]);
  const [icon, setIcon] = useState(existing?.icon || '');

  const selectedCategory = categories.find(cat => cat.id === categoryId);

  const handleSave = async () => {
    if (!name.trim() || !categoryId) return;
    await onSave({
      kind: 'category',
      name: name.trim(),
      categoryId,
      lastFour: lastFour.trim() || null,
      color,
      icon: icon || selectedCategory?.icon || '📂',
    });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType={isMobile ? 'slide' : 'fade'} onRequestClose={onClose}>
      <View style={[m.overlay, isMobile && m.overlayMobile]}>
        <ScrollView contentContainerStyle={[m.scrollContent, isMobile && m.scrollContentMobile]}>
          <View style={[m.box, isMobile && m.boxMobile]}>
            <Text style={m.title}>{isEdit ? 'Edit Account' : 'Add Account'}</Text>

            <Text style={m.label}>Account Name</Text>
            <TextInput
              style={m.input}
              placeholder="e.g. Chase Sapphire"
              value={name}
              onChangeText={setName}
              placeholderTextColor={C.faint}
            />

            <Text style={m.label}>Category</Text>
            {categories.length === 0 ? (
              <Text style={m.emptyFields}>No categories yet — create one first, then come back here.</Text>
            ) : (
              <View style={m.typeGrid}>
                {categories.map(cat => (
                  <TouchableOpacity
                    key={cat.id}
                    style={[m.typeBtn, categoryId === cat.id && m.typeBtnActive]}
                    onPress={() => setCategoryId(cat.id)}
                  >
                    <Text style={m.typeIcon}>{cat.icon}</Text>
                    <Text style={[m.typeTxt, categoryId === cat.id && m.typeTxtActive]}>{cat.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <Text style={m.label}>Last 4 Digits (optional)</Text>
            <TextInput
              style={m.input}
              placeholder="e.g. 5678"
              value={lastFour}
              onChangeText={setLastFour}
              keyboardType="number-pad"
              maxLength={4}
              placeholderTextColor={C.faint}
            />

            <Text style={m.label}>Icon (emoji)</Text>
            <TextInput
              style={m.input}
              placeholder={selectedCategory?.icon || '📂'}
              value={icon}
              onChangeText={setIcon}
              placeholderTextColor={C.faint}
            />

            <Text style={m.label}>Color</Text>
            <View style={m.colorRow}>
              {PALETTE.map(col => (
                <TouchableOpacity
                  key={col}
                  style={[m.colorSwatch, { backgroundColor: col }, color === col && m.colorSwatchActive]}
                  onPress={() => setColor(col)}
                />
              ))}
            </View>

            {selectedCategory && (selectedCategory.fields || []).length > 0 && (
              <>
                <Text style={m.label}>Tracked fields (from "{selectedCategory.name}")</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {selectedCategory.fields.map(f => (
                    <View key={f.id} style={[c.fieldChip, { borderColor: selectedCategory.color }]}>
                      <Text style={[c.fieldChipTxt, { color: selectedCategory.color }]}>{f.label}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            <View style={m.btnRow}>
              <TouchableOpacity style={m.cancelBtn} onPress={onClose}>
                <Text style={m.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={m.saveBtn} onPress={handleSave} disabled={!categoryId}>
                <Text style={m.saveTxt}>{isEdit ? 'Save Changes' : 'Add Account'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Category Chip ──────────────────────────────────────────────────────────
function CategoryChip({ category, accountCount, onEdit, onDelete }) {
  return (
    <View style={[cc.chip, { borderColor: category.color }]}>
      <Text style={cc.chipIcon}>{category.icon}</Text>
      <Text style={[cc.chipName, { color: category.color }]}>{category.name}</Text>
      {accountCount > 0 && <Text style={cc.chipCount}>{accountCount}</Text>}
      <TouchableOpacity onPress={onEdit} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        <Text style={cc.chipAction}>✏️</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onDelete} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        <Text style={cc.chipAction}>🗑️</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Account Card ─────────────────────────────────────────────────────────────
function AccountCard({ account, category, onEdit, onDelete, onLinkBank, color, isMobile }) {
  const isBank = account.kind === 'bank';
  const isLinked = !!account.plaidLinked;
  const fields = isBank ? (account.fields || []) : (category?.fields || []);
  const typeLabel = isBank
    ? (BANK_TYPE_OPTS.find(t => t.id === account.type)?.label || account.type)
    : (category?.name || 'Uncategorized');

  return (
    <View style={[c.card, isMobile && c.cardMobile]}>
      <View style={c.left}>
        <View style={[c.icon, { backgroundColor: color + '20' }]}>
          <Text style={c.iconTxt}>{account.icon || '🏦'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={c.name}>{account.name}</Text>
            {isLinked && (
              <View style={c.linkedBadge}>
                <Text style={c.linkedBadgeTxt}>🔗 Linked</Text>
              </View>
            )}
          </View>
          <Text style={c.type}>
            {typeLabel}
            {account.lastFour ? ` •••• ${account.lastFour}` : ''}
          </Text>
          {fields.length > 0 && (
            <View style={c.fields}>
              {fields.map(f => (
                <View key={f.id} style={[c.fieldChip, { borderColor: color }]}>
                  <Text style={[c.fieldChipTxt, { color }]}>{f.label}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
      <View style={[c.actions, isMobile && c.actionsMobile]}>
        {isBank && (
          <TouchableOpacity style={c.linkBtn} onPress={onLinkBank}>
            <Text style={c.linkTxt}>{isLinked ? '🔄 Re-link' : '🏦 Link Bank'}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={c.editBtn} onPress={onEdit}>
          <Text style={c.editTxt}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity style={c.delBtn} onPress={onDelete}>
          <Text style={c.delTxt}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── AccountsScreen ───────────────────────────────────────────────────────────
export default function AccountsScreen() {
  const {
    accounts, addAccount, updateAccount, deleteAccount,
    categories, addCategory, updateCategory, deleteCategory,
  } = useApp();
  const { openLink, syncBalances } = usePlaidLink();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const [showAddBank, setShowAddBank] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [editingCategory, setEditingCategory] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const banks = accounts.filter(a => a.kind === 'bank');
  const categoryAccounts = accounts.filter(a => a.kind === 'category');
  const uncategorizedAccounts = categoryAccounts.filter(a => !a.categoryId);
  // Accounts created before the category rework have neither kind — still in
  // Firestore untouched, just not shown until restored.
  const legacyAccounts = accounts.filter(a => !a.kind);

  const handleRestoreLegacy = async () => {
    setRestoring(true);
    try {
      await Promise.all(legacyAccounts.map(acc => {
        if (BANK_TYPE_OPTS.some(t => t.id === acc.type)) {
          // Was already a bank account (checking/savings) — just tag it so
          // it resumes showing in the Banks section with its Plaid link and
          // fields intact.
          return updateAccount(acc.id, { kind: 'bank' });
        }
        // Everything else comes back as a bare, uncategorized account —
        // stripped of its old type-specific fields per request, name only.
        return updateAccount(acc.id, { kind: 'category', categoryId: null, fields: deleteField(), type: deleteField() });
      }));
      notify(
        'Accounts Restored',
        `Restored ${legacyAccounts.length} account(s). Assign a category to each one under "Uncategorized" below.`
      );
    } catch (e) {
      notify('Restore Failed', e.message);
    } finally {
      setRestoring(false);
    }
  };

  const handleAddBank = async (data) => {
    await addAccount(data);
    setShowAddBank(false);
  };

  const handleAddAccount = async (data) => {
    await addAccount(data);
    setShowAddAccount(false);
  };

  const handleEdit = async (data) => {
    if (!editingAccount) return;
    await updateAccount(editingAccount.id, data);
    setEditingAccount(null);
  };

  const handleDelete = async (account) => {
    const ok = await confirmAsync(
      'Delete Account',
      `Are you sure you want to delete "${account.name}"? This cannot be undone.`
    );
    if (ok) deleteAccount(account.id);
  };

  const handleLinkBank = (account) => {
    openLink(account.id, async () => {
      await updateAccount(account.id, { plaidLinked: true });
      notify('Bank Linked', `${account.name} is now connected. Tap "Sync Balances" to pull live data.`);
    });
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncBalances();
      notify('Synced', `Updated balances for ${result.synced} account(s).`);
    } catch {
      notify('Sync Failed', 'Could not reach the server. Make sure Cloud Functions are deployed.');
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveCategory = async (data) => {
    if (editingCategory) {
      await updateCategory(editingCategory.id, data);
      setEditingCategory(null);
    } else {
      await addCategory(data);
      setShowAddCategory(false);
    }
  };

  const handleDeleteCategory = async (category) => {
    const inUse = categoryAccounts.filter(a => a.categoryId === category.id).length;
    if (inUse > 0) {
      notify('Category in Use', `${inUse} account(s) use "${category.name}". Reassign or delete them first.`);
      return;
    }
    const ok = await confirmAsync('Delete Category', `Delete the "${category.name}" category? This cannot be undone.`);
    if (ok) deleteCategory(category.id);
  };

  return (
    <ScrollView style={sc.screen} contentContainerStyle={[sc.content, isMobile && sc.contentMobile]}>
      {/* Header */}
      <View style={[sc.header, isMobile && sc.headerMobile]}>
        <View>
          <Text style={sc.title}>Accounts</Text>
          <Text style={sc.subtitle}>Manage your tracked accounts and categories</Text>
        </View>
        <View style={sc.headerActions}>
          <TouchableOpacity style={sc.syncBtn} onPress={handleSync} disabled={syncing}>
            <Text style={sc.syncTxt}>{syncing ? 'Syncing…' : '🔄 Sync Balances'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={sc.addBtnSecondary} onPress={() => setShowAddBank(true)}>
            <Text style={sc.addTxtSecondary}>+ Add Bank</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[sc.addBtn, isMobile && sc.addBtnMobile]} onPress={() => setShowAddAccount(true)}>
            <Text style={sc.addTxt}>+ Add Account</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Categories management */}
      <View style={sc.categoriesSection}>
        <View style={sc.categoriesHeader}>
          <Text style={sc.groupLabel}>📁 Categories</Text>
          <TouchableOpacity onPress={() => setShowAddCategory(true)}>
            <Text style={sc.newCategoryTxt}>+ New Category</Text>
          </TouchableOpacity>
        </View>
        {categories.length === 0 ? (
          <Text style={sc.emptyMsgSmall}>
            No categories yet. Create one (e.g. "Credit Card") to define the fields its accounts will track.
          </Text>
        ) : (
          <View style={cc.chipRow}>
            {categories.map(cat => (
              <CategoryChip
                key={cat.id}
                category={cat}
                accountCount={categoryAccounts.filter(a => a.categoryId === cat.id).length}
                onEdit={() => setEditingCategory(cat)}
                onDelete={() => handleDeleteCategory(cat)}
              />
            ))}
          </View>
        )}
      </View>

      {/* One-time restore for accounts created before categories existed */}
      {legacyAccounts.length > 0 && (
        <View style={sc.migrationBanner}>
          <Text style={sc.migrationTxt}>
            Found {legacyAccounts.length} account{legacyAccounts.length === 1 ? '' : 's'} from before categories existed.
          </Text>
          <TouchableOpacity style={sc.migrationBtn} onPress={handleRestoreLegacy} disabled={restoring}>
            <Text style={sc.migrationBtnTxt}>{restoring ? 'Restoring…' : 'Restore Accounts'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Empty state */}
      {accounts.length === 0 && (
        <View style={sc.empty}>
          <Text style={sc.emptyIcon}>🏦</Text>
          <Text style={sc.emptyTitle}>No accounts yet</Text>
          <Text style={sc.emptyMsg}>
            Add a bank account, or create a category and add an account to it, to start tracking with DAR.
          </Text>
          <TouchableOpacity style={sc.emptyBtn} onPress={() => setShowAddBank(true)}>
            <Text style={sc.emptyBtnTxt}>Add Your First Account</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Account list — grouped: Banks → one group per category */}
      {banks.length > 0 && (
        <View style={{ marginBottom: 8 }}>
          <Text style={sc.groupLabel}>🏦 Banks</Text>
          {banks.map(account => (
            <AccountCard
              key={account.id}
              account={account}
              color={account.color || ACCT_COLORS[accounts.indexOf(account) % ACCT_COLORS.length]}
              onEdit={() => setEditingAccount(account)}
              onDelete={() => handleDelete(account)}
              onLinkBank={() => handleLinkBank(account)}
              isMobile={isMobile}
            />
          ))}
        </View>
      )}
      {uncategorizedAccounts.length > 0 && (
        <View style={{ marginBottom: 8 }}>
          <Text style={sc.groupLabel}>❓ Uncategorized</Text>
          {uncategorizedAccounts.map(account => (
            <AccountCard
              key={account.id}
              account={account}
              category={null}
              color={account.color || ACCT_COLORS[accounts.indexOf(account) % ACCT_COLORS.length]}
              onEdit={() => setEditingAccount(account)}
              onDelete={() => handleDelete(account)}
              isMobile={isMobile}
            />
          ))}
        </View>
      )}
      {categories.map(category => {
        const items = categoryAccounts.filter(a => a.categoryId === category.id);
        if (items.length === 0) return null;
        return (
          <View key={category.id} style={{ marginBottom: 8 }}>
            <Text style={sc.groupLabel}>{category.icon} {category.name}</Text>
            {items.map(account => (
              <AccountCard
                key={account.id}
                account={account}
                category={category}
                color={account.color || category.color}
                onEdit={() => setEditingAccount(account)}
                onDelete={() => handleDelete(account)}
                isMobile={isMobile}
              />
            ))}
          </View>
        );
      })}

      {/* Modals */}
      <BankAccountModal
        visible={showAddBank}
        onClose={() => setShowAddBank(false)}
        onSave={handleAddBank}
        existing={null}
        isMobile={isMobile}
      />
      <CategoryAccountModal
        visible={showAddAccount}
        onClose={() => setShowAddAccount(false)}
        onSave={handleAddAccount}
        existing={null}
        isMobile={isMobile}
        categories={categories}
      />
      <CategoryModal
        visible={showAddCategory}
        onClose={() => setShowAddCategory(false)}
        onSave={handleSaveCategory}
        existing={null}
      />
      {editingCategory && (
        <CategoryModal
          visible={true}
          onClose={() => setEditingCategory(null)}
          onSave={handleSaveCategory}
          existing={editingCategory}
        />
      )}
      {editingAccount && editingAccount.kind === 'bank' && (
        <BankAccountModal
          visible={true}
          onClose={() => setEditingAccount(null)}
          onSave={handleEdit}
          existing={editingAccount}
          isMobile={isMobile}
        />
      )}
      {editingAccount && editingAccount.kind === 'category' && (
        <CategoryAccountModal
          visible={true}
          onClose={() => setEditingAccount(null)}
          onSave={handleEdit}
          existing={editingAccount}
          isMobile={isMobile}
          categories={categories}
        />
      )}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const sc = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: 28, paddingBottom: 60 },
  contentMobile: { padding: 16, paddingBottom: 100 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  headerMobile: { flexDirection: 'column', gap: 12 },
  headerActions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  title: { fontSize: 28, fontWeight: '800', color: C.text },
  subtitle: { fontSize: 14, color: C.muted, marginTop: 4 },
  addBtn: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20, alignSelf: 'flex-start' },
  addBtnMobile: { alignSelf: 'stretch', alignItems: 'center' },
  addTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  addBtnSecondary: { borderWidth: 1, borderColor: C.primary, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, alignSelf: 'flex-start' },
  addTxtSecondary: { color: C.primary, fontWeight: '600', fontSize: 14 },
  syncBtn: { borderWidth: 1, borderColor: C.primary, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, alignSelf: 'flex-start' },
  syncTxt: { color: C.primary, fontWeight: '600', fontSize: 14 },
  categoriesSection: { marginBottom: 24, backgroundColor: C.card, borderRadius: 16, padding: 16 },
  categoriesHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  newCategoryTxt: { color: C.primary, fontWeight: '600', fontSize: 13 },
  emptyMsgSmall: { fontSize: 13, color: C.muted, lineHeight: 19 },
  migrationBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
    backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FDBA74', borderRadius: 12,
    padding: 14, marginBottom: 20,
  },
  migrationTxt: { fontSize: 13, color: '#9A3412', fontWeight: '600', flexShrink: 1 },
  migrationBtn: { backgroundColor: '#F97316', borderRadius: 10, paddingVertical: 9, paddingHorizontal: 16 },
  migrationBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
  empty: { alignItems: 'center', paddingVertical: 80 },
  emptyIcon: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 24, fontWeight: '700', color: C.text, marginBottom: 8 },
  emptyMsg: { fontSize: 15, color: C.muted, textAlign: 'center', maxWidth: 360, lineHeight: 22, marginBottom: 28 },
  emptyBtn: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28 },
  emptyBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  groupLabel: { fontSize: 13, fontWeight: '700', color: C.muted, marginBottom: 8, marginTop: 4, letterSpacing: 0.5, textTransform: 'uppercase' },
});

const cc = StyleSheet.create({
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: '#FAFAFA',
  },
  chipIcon: { fontSize: 15 },
  chipName: { fontSize: 13, fontWeight: '700' },
  chipCount: { fontSize: 11, color: C.faint, fontWeight: '600' },
  chipAction: { fontSize: 12, marginLeft: 2 },
});

const c = StyleSheet.create({
  card: {
    backgroundColor: C.card, borderRadius: 16, padding: 20, marginBottom: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    shadowColor: '#000', shadowOffset: {width:0,height:2}, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  cardMobile: { flexDirection: 'column', alignItems: 'flex-start', gap: 12 },
  left: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, flex: 1 },
  icon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  iconTxt: { fontSize: 22 },
  name: { fontSize: 17, fontWeight: '700', color: C.text },
  type: { fontSize: 13, color: C.faint, marginTop: 2 },
  fields: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  fieldChip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  fieldChipTxt: { fontSize: 12, fontWeight: '500' },
  actions: { flexDirection: 'row', gap: 8 },
  actionsMobile: { width: '100%', justifyContent: 'flex-end' },
  linkBtn: { borderWidth: 1, borderColor: '#22C55E', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#F0FDF4' },
  linkTxt: { fontSize: 13, color: '#16A34A', fontWeight: '600' },
  linkedBadge: { backgroundColor: '#DCFCE7', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  linkedBadgeTxt: { fontSize: 11, color: '#16A34A', fontWeight: '600' },
  editBtn: { borderWidth: 1, borderColor: C.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  editTxt: { fontSize: 13, color: C.primary, fontWeight: '600' },
  delBtn: { borderWidth: 1, borderColor: '#FEE2E2', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: '#FEF2F2' },
  delTxt: { fontSize: 13, color: C.bills, fontWeight: '600' },
});

const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },
  overlayMobile: { justifyContent: 'flex-end' },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  scrollContentMobile: { padding: 0 },
  box: { backgroundColor: C.card, borderRadius: 20, padding: 28, width: 520, maxWidth: '100%', alignSelf: 'center' },
  boxMobile: { width: '100%', maxWidth: '100%', borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '800', color: C.text, marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 8, marginTop: 16 },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: C.text, backgroundColor: '#FAFAFA' },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeBtn: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  typeBtnActive: { borderColor: C.primary, backgroundColor: C.primaryLight },
  typeIcon: { fontSize: 16 },
  typeTxt: { fontSize: 13, color: C.muted, fontWeight: '500' },
  typeTxtActive: { color: C.primary, fontWeight: '600' },
  colorRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  colorSwatch: { width: 32, height: 32, borderRadius: 16 },
  colorSwatchActive: { borderWidth: 3, borderColor: '#1F2937' },
  emptyFields: { fontSize: 13, color: C.faint, fontStyle: 'italic', marginBottom: 8 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F9FAFB', borderRadius: 8, padding: 10, marginBottom: 6 },
  fieldInfo: { flex: 1 },
  fieldName: { fontSize: 14, fontWeight: '600', color: C.text },
  fieldType: { fontSize: 12, color: C.faint, marginTop: 2 },
  fieldDel: { padding: 6 },
  fieldDelTxt: { fontSize: 20, color: C.faint },
  addFieldRow: { gap: 8, marginTop: 8 },
  fieldTypeSelect: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  ftBtn: { borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  ftBtnActive: { borderColor: C.primary, backgroundColor: C.primaryLight },
  ftTxt: { fontSize: 12, color: C.muted },
  ftTxtActive: { color: C.primary, fontWeight: '600' },
  addFieldBtn: { backgroundColor: C.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  addFieldTxt: { color: '#fff', fontWeight: '600', fontSize: 14 },
  btnRow: { flexDirection: 'row', gap: 12, marginTop: 24 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  cancelTxt: { fontSize: 15, color: C.muted, fontWeight: '500' },
  saveBtn: { flex: 1, backgroundColor: C.primary, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  saveTxt: { fontSize: 15, color: '#fff', fontWeight: '700' },
});
