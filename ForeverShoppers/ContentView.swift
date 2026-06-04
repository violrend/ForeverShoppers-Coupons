import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "tag.fill")
                .font(.system(size: 56))
                .foregroundStyle(.purple)

            Text("ForeverShoppers Coupons")
                .font(.title2)
                .fontWeight(.bold)

            Text("Enable the Safari extension to find available coupons while shopping on iPhone and iPad.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .padding(.horizontal)

            VStack(alignment: .leading, spacing: 10) {
                Text("1. Open Settings")
                Text("2. Go to Safari → Extensions")
                Text("3. Turn on ForeverShoppers Coupons")
                Text("4. Allow it on shopping websites")
            }
            .font(.body)
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal)
        }
        .padding()
    }
}
