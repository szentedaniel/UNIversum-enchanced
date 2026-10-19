export const formatter = (value) => {
    const formatter = new Intl.NumberFormat('hu-HU', {
        style: 'currency',
        currency: 'HUF',
        minimumFractionDigits: 0
    })

    return formatter.format(value)
}

export default formatter