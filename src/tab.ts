import { Storage } from '@bhmb/bot';
import { UIExtensionExports } from '@bhmb/ui';

import {
    AccountManager,
    PermissionManager, Permissions, PermissionValues,
    BankerManager,
    MessageManager, Messages,
} from './stored';

import commandsHTML from './html/commands.html';
import accountsHTML from './html/accounts.html';
import settingsHTML from './html/settings.html';
import { AccountArray, AccountArrayElement } from './stored/accounts';

import { debounce } from './helpers';

export class BankingTab {
    private commandTab!: HTMLDivElement;
    private accountsTab!: HTMLDivElement;
    private settingsTab!: HTMLDivElement;

    constructor(
        private ui: UIExtensionExports,
        private accounts: AccountManager,
        private perms: PermissionManager,
        private bankers: BankerManager,
        private messages: MessageManager,
        private storage: Storage
    ) {
        this.ui.addTabGroup('Banking', 'banking');
        this.initCommandTab();
        this.initAccountsTab();
        this.initSettingsTab();
    }

    initCommandTab() {
        this.commandTab = this.ui.addTab('Commands', 'banking');
        this.commandTab.innerHTML = commandsHTML;

        for (let el of this.commandTab.querySelectorAll('[data-perm]') as NodeListOf<HTMLInputElement>) {
            el.value = this.perms.getPerm(el.dataset['perm'] as keyof Permissions);
        }

        this.commandTab.addEventListener('change', () => {
            for (let el of this.commandTab.querySelectorAll('[data-perm]') as NodeListOf<HTMLInputElement>) {
                this.perms.setPerm(el.dataset['perm'] as keyof Permissions, el.value as PermissionValues);
            }
        });
    }

    initAccountsTab() {
        this.accountsTab = this.ui.addTab('Accounts', 'banking');
        this.accountsTab.innerHTML = accountsHTML;

        const input = this.accountsTab.querySelector('input')!;
        const container = this.accountsTab.querySelector('tbody')!;
        const template = this.accountsTab.querySelector('template')!;

        function formatDate(epoch: number | undefined): string {
            if (!epoch) return 'Never';
            const date = new Date(epoch);
            return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
        }

        const showAccounts = (accounts: AccountArray) => {
            container.innerHTML = '';

            for (const account of accounts) {
                this.ui.buildTemplate(template, container, [
                    { selector: 'tr', account_name: account.name },
                    { selector: '[data-for=name]', text: account.name },
                    { selector: '[data-for=last_daily_award]', text: formatDate(account.last_daily_award) },
                    { selector: '[type=checkbox]', checked: this.bankers.isBanker(account.name) },
                    { selector: 'input', value: account.balance }
                ]);
            }
        };

        const getSortType = (): 'bal_d' | 'bal_a' | 'daily_d' | 'daily_a' => {
            return (<HTMLInputElement>this.accountsTab.querySelector('[name=sort]:checked')).value as any;
        };

        // Searching for a single name
        //tslint:disable-next-line
        const checkNames = () => {
            // Update bankers
            const rows = Array.from(this.accountsTab.querySelectorAll('tr[account_name]'));
            for (const row of rows) {
                const banker = row.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked;
                this.bankers.setBanker(row.getAttribute('account_name')!, banker);
            }

            const name = input.value.toLocaleUpperCase().trim();
            let accountFilter = (account: AccountArrayElement) => account.name.includes(name);

            if (name === '') {
                accountFilter = () => true;
            } else if (name === 'IS:BANKER') {
                const bankers = this.bankers.getBankers();
                accountFilter = account => bankers.includes(account.name);
            } else if (/balance:[<>]?\d+/i.test(name)) {
                const result = name.match(/(\d+)/)!;
                const amount = result ? +result[1] : 0;
                if (name.includes('<')) {
                    accountFilter = account => account.balance < amount;
                } else if (name.includes('>')) {
                    accountFilter = account => account.balance > amount;
                } else {
                    accountFilter = account => account.balance === amount;
                }
            }

            const accounts = this.accounts.getAll().filter(accountFilter);

            // Sort
            switch (getSortType()) {
                case 'bal_d':
                    accounts.sort((a, b) => b.balance - a.balance);
                    break;
                case 'bal_a':
                    accounts.sort((a, b) => a.balance - b.balance);
                    break;
                case 'daily_d':
                    accounts.sort((a, b) => {
                        if (!a.last_daily_award) return 1;
                        if (!b.last_daily_award) return -1;
                        return b.last_daily_award - a.last_daily_award;
                    });
                    break;
                case 'daily_a':
                    accounts.sort((a, b) => {
                        if (!a.last_daily_award) return 1;
                        if (!b.last_daily_award) return -1;
                        return a.last_daily_award - b.last_daily_award;
                    });
                    break;
                default:
                    break;
            }

            if (accounts.length > 300) {
                this.ui.notify(`Showing 300/${accounts.length} matches`);
                accounts.length = 300;
            }


            showAccounts(accounts);
        };

        input.addEventListener('input', debounce(checkNames, 300));
        this.accountsTab.addEventListener('change', checkNames);

        // Deleting accounts
        this.accountsTab.querySelector('button.is-danger')!.addEventListener('click', () => {
            this.ui.alert(
                'Are you sure? This will delete all accounts currently shown on the page.',
                [{ text: 'Delete', style: 'is-danger'}, 'Cancel'],
                response => {
                    if (response !== 'Delete') return;
                    const names = Array.from(this.accountsTab.querySelectorAll('tr[account_name]'))
                        .map(tr => tr.getAttribute('account_name')!);

                    this.accounts.removeAccounts(names);
                    checkNames();
                }
            );
        });

        // Making accounts banker
        this.accountsTab.addEventListener('change', event => {
            const target = event.target as HTMLInputElement;
            if (target.matches('[type=checkbox]')) {
                const row = target.parentElement!.parentElement!.parentElement!;
                this.bankers.setBanker(row.getAttribute('account_name') || '', target.checked);
            }
        });

        checkNames();
    }

    initSettingsTab() {
        this.settingsTab = this.ui.addTab('Settings', 'banking');
        this.settingsTab.innerHTML = settingsHTML;

        let currencyInput = this.settingsTab.querySelector('input') as HTMLInputElement;

        currencyInput.value = this.storage.get('name', 'Server Coin');

        for (let el of this.settingsTab.querySelectorAll('[data-msg-key]') as NodeListOf<HTMLInputElement>) {
            el.value = this.messages.getMessage(el.dataset['msgKey'] as keyof Messages);
        }

        this.settingsTab.addEventListener('change', () => {
            for (let el of this.settingsTab.querySelectorAll('[data-msg-key]') as NodeListOf<HTMLInputElement>) {
                this.messages.setMessage(el.dataset['msgKey'] as keyof Messages, el.value);
            }

            this.storage.set('name', currencyInput.value);
        });
    }

    remove() {
        this.ui.removeTabGroup('banking');
    }
}
