<?php

namespace Tests\Feature;

use App\Modules\Identity\Domain\Roles;
use App\Modules\Identity\Infrastructure\Models\User;
use App\Modules\Shared\Domain\Enums\VendorStatus;
use App\Modules\Vendor\Infrastructure\Models\BankAccount;
use App\Modules\Vendor\Infrastructure\Models\Store;
use App\Modules\Vendor\Infrastructure\Models\Vendor;
use App\Modules\Wallet\Application\Services\WalletService;
use App\Modules\Wallet\Infrastructure\Models\PayoutRequest;
use App\Modules\Wallet\Infrastructure\Models\VendorWallet;
use App\Modules\Wallet\Infrastructure\Models\WalletTransaction;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

class VendorWalletPayoutTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(RolePermissionSeeder::class);
    }

    public function test_vendor_can_request_payout_from_available_balance_without_a_settlement(): void
    {
        [$user, $vendor, $bankAccount, $wallet] = $this->createVendorWallet(5000, 5000, 0);

        $this->actingAs($user)
            ->postJson('/api/v1/vendor/wallet/payouts', [
                'amount' => 4500,
                'bank_account_id' => $bankAccount->uuid,
            ])
            ->assertCreated()
            ->assertJsonPath('data.amount', '4500.00')
            ->assertJsonPath('data.settlement_id', null)
            ->assertJsonPath('data.funding_source', PayoutRequest::FUNDING_SOURCE_AVAILABLE_BALANCE);

        $this->assertDatabaseHas('payout_requests', [
            'vendor_id' => $vendor->id,
            'settlement_id' => null,
            'funding_source' => PayoutRequest::FUNDING_SOURCE_AVAILABLE_BALANCE,
            'amount' => 4500,
        ]);
        $this->assertSame('500.00', $wallet->fresh()->balance);
        $this->assertSame('500.00', $wallet->fresh()->available_balance);
        $this->assertSame('0.00', $wallet->fresh()->pending_balance);
        $this->assertDatabaseHas('wallet_transactions', [
            'wallet_id' => $wallet->id,
            'transaction_type' => 'debit_withdrawal',
            'amount' => 4500,
            'status' => 'held',
        ]);
    }

    public function test_rejected_available_balance_payout_restores_available_not_pending_funds(): void
    {
        [$user, $vendor, $bankAccount, $wallet] = $this->createVendorWallet(5000, 5000, 0);

        $this->actingAs($user)
            ->postJson('/api/v1/vendor/wallet/payouts', [
                'amount' => 4500,
                'bank_account_id' => $bankAccount->uuid,
            ])
            ->assertCreated();

        $payout = PayoutRequest::query()->where('vendor_id', $vendor->id)->firstOrFail();
        app(WalletService::class)->rejectPayout($payout, $user, 'Bank details require correction.');

        $this->assertSame('5000.00', $wallet->fresh()->balance);
        $this->assertSame('5000.00', $wallet->fresh()->available_balance);
        $this->assertSame('0.00', $wallet->fresh()->pending_balance);
    }

    public function test_vendor_cannot_request_more_than_the_available_wallet_balance(): void
    {
        [$user, $vendor, $bankAccount, $wallet] = $this->createVendorWallet(5000, 5000, 0);

        $this->actingAs($user)
            ->postJson('/api/v1/vendor/wallet/payouts', [
                'amount' => 5001,
                'bank_account_id' => $bankAccount->uuid,
            ])
            ->assertUnprocessable();

        $this->assertDatabaseCount('payout_requests', 0);
        $this->assertSame('5000.00', $wallet->fresh()->balance);
        $this->assertSame('5000.00', $wallet->fresh()->available_balance);
    }

    public function test_admin_payout_profiles_always_include_vendors_with_wallet_and_bank_details(): void
    {
        [, $vendor, $bankAccount] = $this->createVendorWallet(5000, 3500, 1500);
        $store = Store::query()->create([
            'vendor_id' => $vendor->id,
            'name' => 'Wallet Profile Store',
            'slug' => 'wallet-profile-store-'.$vendor->id,
        ]);

        $noWalletUser = User::factory()->create();
        $noWalletVendor = Vendor::query()->create([
            'user_id' => $noWalletUser->id,
            'company_name' => 'Z Vendor Without Wallet',
            'business_email' => 'no-wallet-'.$noWalletUser->id.'@example.test',
            'status' => VendorStatus::APPROVED,
        ]);
        $admin = User::factory()->create();
        $admin->assignRole(Roles::SUPER_ADMIN);

        $response = $this->actingAs($admin)
            ->getJson('/api/v1/admin/wallet/payout-profiles?per_page=100')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.vendor_id', $vendor->uuid)
            ->assertJsonPath('data.0.stores.0.name', $store->name)
            ->assertJsonPath('data.0.wallet.available_balance', '3500.00')
            ->assertJsonPath('data.0.bank_accounts.0.account_number', $bankAccount->account_number)
            ->assertJsonPath('data.1.vendor_id', $noWalletVendor->uuid)
            ->assertJsonPath('data.1.wallet.balance', '0.00');

        $response->assertJsonPath('data.1.bank_accounts', []);
    }

    private function createVendorWallet(float $balance, float $available, float $pending): array
    {
        Role::findOrCreate(Roles::VENDOR_ADMIN, 'web');
        $user = User::factory()->create();
        $user->assignRole(Roles::VENDOR_ADMIN);

        $vendor = Vendor::query()->create([
            'user_id' => $user->id,
            'company_name' => 'Wallet Payout Vendor',
            'business_email' => 'wallet-payout-'.$user->id.'@example.test',
            'status' => VendorStatus::APPROVED,
        ]);

        $bankAccount = BankAccount::query()->create([
            'vendor_id' => $vendor->id,
            'bank_name' => 'Test Bank',
            'account_name' => 'Wallet Payout Vendor',
            'account_number' => 'ACC'.$user->id,
        ]);

        $wallet = VendorWallet::query()->create([
            'vendor_id' => $vendor->id,
            'balance' => $balance,
            'available_balance' => $available,
            'pending_balance' => $pending,
            'currency' => 'NPR',
            'version' => 1,
        ]);

        return [$user, $vendor, $bankAccount, $wallet];
    }
}